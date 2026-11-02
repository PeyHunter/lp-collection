import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { sql } from "drizzle-orm";
import type { Database } from "./db.ts";

/** How long nightly backups are kept. */
export const keepDays = 30;
const rowsPerLine = 500;
const fileKeyPattern = /^[0-9a-f]{32}$/;

type Header = { format: "lp-collection-backup"; version: 1; migrations: number; createdAt: string };
type Line = Header | { table: string; rows: Record<string, unknown>[] };
type TableInfo = { name: string; dependsOn: string[] };

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const day = (date: Date) => date.toISOString().slice(0, 10);

/** Every table in the app's schema, each after the tables its foreign keys point to. */
async function tablesInOrder({ db }: Database) {
  const { rows } = await db.execute<{ name: string; depends_on: string[] }>(sql`
    select c.relname::text as name, coalesce(array_agg(distinct r.relname::text) filter (where r.relname is not null and r.oid <> c.oid), '{}')::text[] as depends_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    left join pg_constraint k on k.conrelid = c.oid and k.contype = 'f'
    left join pg_class r on r.oid = k.confrelid
    where c.relkind = 'r'
    group by c.relname
    order by c.relname`);
  const tables: TableInfo[] = rows.map((row) => ({ name: row.name, dependsOn: row.depends_on }));
  const ordered: string[] = [];
  while (ordered.length < tables.length) {
    const ready = tables.filter((table) => !ordered.includes(table.name) && table.dependsOn.every((name) => ordered.includes(name)));
    if (ready.length === 0) throw new Error("The tables' foreign keys go round in a circle, so they have no order to restore in");
    ordered.push(...ready.map((table) => table.name));
  }
  return ordered;
}

async function appliedMigrations({ db }: Database) {
  const { rows } = await db.execute<{ count: number }>(sql`select count(*)::int as count from drizzle.__drizzle_migrations`);
  return rows[0]!.count;
}

export type BackupResult = { file: string; tables: number; rows: number; photos: { kept: number; fetched: number } };

/**
 * One night's backup into `dir`: the database as gzipped JSON lines in `db/<day>.jsonl.gz`, the Photos it names in
 * `db/<day>.photos.json`, and each Photo once in `photos/`, shared by every night that names it.
 */
export async function writeBackup({
  database,
  dir,
  now,
  fetchPhoto,
}: {
  database: Database;
  dir: string;
  now: () => Date;
  fetchPhoto: (fileKey: string) => Promise<Uint8Array>;
}): Promise<BackupResult> {
  await mkdir(join(dir, "db"), { recursive: true });
  await mkdir(join(dir, "photos"), { recursive: true });
  const name = day(now());
  const file = join(dir, "db", `${name}.jsonl.gz`);
  const partial = `${file}.partial`;
  const header: Header = { format: "lp-collection-backup", version: 1, migrations: await appliedMigrations(database), createdAt: now().toISOString() };
  const lines: string[] = [JSON.stringify(header)];
  let rowCount = 0;
  const fileKeys: string[] = [];
  const tables = await tablesInOrder(database);
  // One snapshot of every table, so a Copy saved during the backup can't be half in it.
  await database.db.transaction(
    async (tx) => {
      for (const table of tables) {
        const { rows } = await tx.execute<{ row: Record<string, unknown> }>(sql.raw(`select row_to_json(t) as row from ${quote(table)} t`));
        rowCount += rows.length;
        for (let start = 0; start < rows.length; start += rowsPerLine) {
          lines.push(JSON.stringify({ table, rows: rows.slice(start, start + rowsPerLine).map((each) => each.row) }));
        }
        if (table === "photos") fileKeys.push(...rows.map((each) => String(each.row.file_key)));
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  await pipeline(
    (async function* () {
      for (const line of lines) yield `${line}\n`;
    })(),
    createGzip(),
    createWriteStream(partial),
  );

  let fetched = 0;
  for (const fileKey of fileKeys) {
    if (!fileKeyPattern.test(fileKey)) throw new Error(`Photo ${fileKey} has a file key the app never makes`);
    const target = join(dir, "photos", `${fileKey}.jpg`);
    if (await stat(target).catch(() => undefined)) continue;
    await writeFile(`${target}.partial`, await fetchPhoto(fileKey));
    await rename(`${target}.partial`, target);
    fetched += 1;
  }
  // The night counts only once its Photos are safe too, so a backup that failed halfway leaves no night behind.
  await writeFile(join(dir, "db", `${name}.photos.json`), JSON.stringify(fileKeys));
  await rename(partial, file);
  return { file, tables: tables.length, rows: rowCount, photos: { kept: fileKeys.length, fetched } };
}

/** Deletes nights older than `keepDays`, and every Photo no night that is kept still names. Never deletes the newest night. */
export async function pruneBackups(dir: string, now: () => Date) {
  const nights = (await readdir(join(dir, "db")))
    .filter((name) => name.endsWith(".jsonl.gz"))
    .map((name) => name.slice(0, 10))
    .sort();
  const oldest = day(new Date(now().getTime() - keepDays * 24 * 60 * 60 * 1000));
  const dropped = nights.slice(0, -1).filter((night) => night < oldest);
  for (const night of dropped) {
    await rm(join(dir, "db", `${night}.jsonl.gz`), { force: true });
    await rm(join(dir, "db", `${night}.photos.json`), { force: true });
  }
  const named = new Set<string>();
  for (const night of nights.filter((each) => !dropped.includes(each))) {
    const keys = JSON.parse(await readFile(join(dir, "db", `${night}.photos.json`), "utf8").catch(() => "[]")) as string[];
    for (const key of keys) named.add(key);
  }
  let photosRemoved = 0;
  for (const name of await readdir(join(dir, "photos"))) {
    if (named.has(name.replace(/\.jpg$/, ""))) continue;
    await rm(join(dir, "photos", name), { force: true });
    photosRemoved += 1;
  }
  return { nightsRemoved: dropped, photosRemoved };
}

async function* readLines(file: string): AsyncGenerator<Line> {
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) if (line) yield JSON.parse(line) as Line;
}

/**
 * Loads a backup into a database that has just been migrated and holds nothing, then copies its Photos into
 * `photosDir`. Without `photosDir` it answers which Photos to copy by hand: in the cluster the backups and the
 * app's Photos live on different nodes. The database must be at the same migration as the backup: restore with
 * the image that made it.
 */
export async function restoreBackup({ database, file, photosFrom, photosDir }: { database: Database; file: string; photosFrom: string; photosDir?: string }) {
  const { db } = database;
  const tables = await tablesInOrder(database);
  for (const table of tables) {
    const { rows } = await db.execute<{ any: boolean }>(sql.raw(`select exists (select 1 from ${quote(table)}) as any`));
    if (rows[0]!.any) throw new Error(`The database already holds ${table}. Restore only into an empty database.`);
  }
  const lines = readLines(file);
  const first = (await lines.next()).value as Header | undefined;
  if (first?.format !== "lp-collection-backup" || first.version !== 1) throw new Error(`${file} is not an LP-Collection backup`);
  const migrations = await appliedMigrations(database);
  if (first.migrations !== migrations) {
    throw new Error(`The backup was made at migration ${first.migrations} and this database is at ${migrations}. Restore with the app image that made the backup.`);
  }
  const { rows: columnRows } = await db.execute<{ table_name: string; column_name: string; is_identity: string }>(sql`
    select table_name, column_name, is_identity from information_schema.columns
    where table_schema = 'public' and is_generated = 'NEVER'`);
  const columns = (table: string) => columnRows.filter((row) => row.table_name === table);
  const fileKeys: string[] = [];
  const counts = new Map<string, number>();
  await db.transaction(async (tx) => {
    for await (const line of lines) {
      if (!("table" in line)) continue;
      if (!tables.includes(line.table)) throw new Error(`The backup has a table, ${line.table}, this database doesn't`);
      const names = columns(line.table)
        .map((column) => quote(column.column_name))
        .join(", ");
      await tx.execute(
        sql`${sql.raw(`insert into ${quote(line.table)} (${names}) overriding system value select ${names} from json_populate_recordset(null::${quote(line.table)}, `)}${JSON.stringify(line.rows)}::json)`,
      );
      counts.set(line.table, (counts.get(line.table) ?? 0) + line.rows.length);
      if (line.table === "photos") fileKeys.push(...line.rows.map((row) => String(row.file_key)));
    }
    for (const { table_name: table, column_name: column } of columnRows.filter((row) => row.is_identity === "YES")) {
      await tx.execute(
        sql.raw(`select setval(pg_get_serial_sequence('${quote(table)}', '${column}'), greatest(coalesce(max(${quote(column)}), 0), 1), max(${quote(column)}) is not null) from ${quote(table)}`),
      );
    }
  });
  if (!photosDir) return { rows: Object.fromEntries(counts), photos: 0, photosToCopy: fileKeys };
  await mkdir(photosDir, { recursive: true });
  for (const fileKey of fileKeys) {
    if (!fileKeyPattern.test(fileKey)) throw new Error(`Photo ${fileKey} has a file key the app never makes`);
    await copyFile(join(photosFrom, `${fileKey}.jpg`), join(photosDir, `${fileKey}.jpg`));
  }
  return { rows: Object.fromEntries(counts), photos: fileKeys.length, photosToCopy: [] };
}
