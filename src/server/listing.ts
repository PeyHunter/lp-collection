import { sql, type SQL } from "drizzle-orm";
import type { Database } from "./db.ts";
import type { Condition, Currency } from "./discogs.ts";
import type { copies, releases } from "./schema.ts";
import type { CopyValue } from "./valuation.ts";

export const sortNames = ["value", "artist", "year", "period", "added"] as const;
export type SortName = (typeof sortNames)[number];
export type Direction = "asc" | "desc";

export type ListQuery = {
  search: string;
  sort: SortName;
  direction: Direction;
  period: number | null;
  genre: string | null;
  after: string[] | null;
  limit: number;
};

type KeyType = "boolean" | "numeric" | "integer" | "text" | "timestamptz" | "uuid";
type Key = { column: SQL; type: KeyType; direction: Direction };

const flip = (direction: Direction): Direction => (direction === "asc" ? "desc" : "asc");
const asc = (column: SQL, type: KeyType): Key => ({ column, type, direction: "asc" });

const valueBands = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10];
const newestFirst: Key[] = [
  { column: sql`created_at`, type: "timestamptz", direction: "desc" },
  { column: sql`id`, type: "uuid", direction: "desc" },
];
const byArtistAndTitle = [asc(sql`artist_key`, "text"), asc(sql`title_key`, "text"), ...newestFirst];

/**
 * Each sort is an ordered list of keys that ends in the Copy's id, so the order is total and a page can
 * continue after the last Copy it showed. Copies with no Value, or no Original year, come last whichever way.
 */
const sorts: Record<SortName, { defaultDirection: Direction; keys: (direction: Direction) => Key[]; group: SQL; usesValue?: true }> = {
  value: {
    defaultDirection: "desc",
    usesValue: true,
    keys: (direction) => [asc(sql`(value is null)`, "boolean"), { column: sql`coalesce(value, 0)`, type: "numeric", direction }, ...byArtistAndTitle],
    group: sql.raw(`case when value is null then 'none' ${valueBands.map((band) => `when value >= ${band} then '${band}'`).join(" ")} else '0' end`),
  },
  artist: {
    defaultDirection: "asc",
    keys: (direction) => [{ column: sql`artist_key`, type: "text", direction }, asc(sql`coalesce(original_year, 9999)`, "integer"), asc(sql`title_key`, "text"), ...newestFirst],
    group: sql`case when artist_key ~ '^[[:alpha:]]' then upper(left(artist_key, 1)) else '#' end`,
  },
  year: {
    defaultDirection: "asc",
    keys: (direction) => [asc(sql`(original_year is null)`, "boolean"), { column: sql`coalesce(original_year, 0)`, type: "integer", direction }, ...byArtistAndTitle],
    group: sql`coalesce(original_year::text, 'unknown')`,
  },
  period: {
    defaultDirection: "asc",
    keys: (direction) => [
      asc(sql`(original_year is null)`, "boolean"),
      { column: sql`coalesce(original_year / 10 * 10, 0)`, type: "integer", direction },
      asc(sql`artist_key`, "text"),
      asc(sql`coalesce(original_year, 0)`, "integer"),
      asc(sql`title_key`, "text"),
      ...newestFirst,
    ],
    group: sql`coalesce((original_year / 10 * 10)::text, 'unknown')`,
  },
  added: {
    defaultDirection: "desc",
    keys: (direction) => newestFirst.map((key) => ({ ...key, direction: direction === "desc" ? key.direction : flip(key.direction) })),
    group: sql`to_char(created_at at time zone 'UTC', 'YYYY-MM')`,
  },
};

export function defaultDirection(sort: SortName) {
  return sorts[sort].defaultDirection;
}

const keyPatterns: Record<KeyType, RegExp> = {
  boolean: /^(true|false)$/,
  numeric: /^-?\d{1,12}(\.\d{1,2})?$/,
  integer: /^-?\d{1,6}$/,
  text: /^[\s\S]{0,1000}$/,
  timestamptz: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

/** A cursor names the sort it belongs to, so it can't be replayed against another order. */
export function encodeCursor(sort: SortName, direction: Direction, values: string[]) {
  return Buffer.from(JSON.stringify([sort, direction, values])).toString("base64url");
}

export function decodeCursor(cursor: string, sort: SortName, direction: Direction): string[] | undefined {
  if (cursor.length > 4000) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!Array.isArray(decoded) || decoded[0] !== sort || decoded[1] !== direction || !Array.isArray(decoded[2])) return undefined;
  const values = decoded[2] as unknown[];
  const keys = sorts[sort].keys(direction);
  if (values.length !== keys.length) return undefined;
  return values.every((value, index) => typeof value === "string" && keyPatterns[keys[index]!.type].test(value)) ? (values as string[]) : undefined;
}

const keyColumn = (index: number) => sql.raw(`k${index}`);

function after(keys: Key[], values: string[]) {
  const beyond = keys.map((key, index) => {
    const value = sql`${values[index]}::${sql.raw(key.type)}`;
    const equalBefore = keys.slice(0, index).map((earlier, earlierIndex) => sql`${keyColumn(earlierIndex)} = ${values[earlierIndex]}::${sql.raw(earlier.type)}`);
    return sql.join([...equalBefore, key.direction === "asc" ? sql`${keyColumn(index)} > ${value}` : sql`${keyColumn(index)} < ${value}`], sql` and `);
  });
  return sql`(${sql.join(beyond, sql`) or (`)})`;
}

function likePattern(text: string) {
  return `%${text.replaceAll(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function searchCondition(search: string) {
  const words = search.split(/\s+/).filter(Boolean);
  if (words.length === 0) return sql`true`;
  const everyWord = sql.join(
    words.map((word) => sql`r.search_text like lower(${likePattern(word)})`),
    sql` and `,
  );
  const compact = search.replaceAll(/[^\p{L}\p{N}]/gu, "");
  if (!compact || (words.length === 1 && compact === words[0])) return sql`(${everyWord})`;
  return sql`((${everyWord}) or r.search_text like lower(${likePattern(compact)}))`;
}

/** The snapshot that is a Copy's Value for a viewer: the latest in their currency for the Copy's current Media condition. */
export function latestSnapshot(copy: SQL, currency: Currency) {
  return sql`
    select s.media_condition, s.value, s.lowest_listing, s.currency, s.fetched_at
    from value_snapshots s
    where s.copy_id = ${copy}.id and s.currency = ${currency} and s.media_condition = ${copy}.media_condition
    order by s.fetched_at desc, s.id desc
    limit 1`;
}

type ListedRow = {
  id: string;
  collection_id: string;
  media_condition: Condition;
  sleeve_condition: (typeof copies.$inferSelect)["sleeveCondition"];
  note: string | null;
  purchase_price: string | null;
  purchase_currency: Currency | null;
  purchase_date: string | null;
  created_at: string;
  discogs_release_id: number;
  artist: string;
  title: string;
  label: string | null;
  catalog_number: string | null;
  country: string | null;
  pressing_year: number | null;
  original_year: number | null;
  cover_image_url: string | null;
  genres: string[] | null;
  styles: string[] | null;
  release_fetched_at: string;
  value_media_condition: Condition | null;
  value: string | null;
  lowest_listing: string | null;
  value_currency: Currency | null;
  value_fetched_at: string | null;
  group_key: string;
  group_total: string;
  total: string;
  cursor_values: string[];
};

export type CachedRelease = Omit<typeof releases.$inferSelect, "searchText" | "artistSortKey">;

export type ListedCopy = { copy: typeof copies.$inferSelect; release: CachedRelease; value: CopyValue | undefined };

export type ListGroup = { key: string; total: number; length: number };

export type Facets = { periods: { period: number; count: number }[]; genres: { genre: string; count: number }[] };

function listedCopy(row: ListedRow): ListedCopy {
  return {
    copy: {
      id: row.id,
      collectionId: row.collection_id,
      discogsReleaseId: row.discogs_release_id,
      mediaCondition: row.media_condition,
      sleeveCondition: row.sleeve_condition,
      note: row.note,
      purchasePrice: row.purchase_price === null ? null : Number(row.purchase_price),
      purchaseCurrency: row.purchase_currency,
      purchaseDate: row.purchase_date,
      createdAt: new Date(row.created_at),
    },
    release: {
      discogsReleaseId: row.discogs_release_id,
      artist: row.artist,
      title: row.title,
      label: row.label,
      catalogNumber: row.catalog_number,
      country: row.country,
      pressingYear: row.pressing_year,
      originalYear: row.original_year,
      coverImageUrl: row.cover_image_url,
      genres: row.genres,
      styles: row.styles,
      fetchedAt: new Date(row.release_fetched_at),
    },
    value:
      row.value_currency && row.value_media_condition && row.value_fetched_at
        ? {
            mediaCondition: row.value_media_condition,
            value: row.value === null ? null : Number(row.value),
            lowestListing: row.lowest_listing === null ? null : Number(row.lowest_listing),
            currency: row.value_currency,
            fetchedAt: new Date(row.value_fetched_at).toISOString(),
          }
        : undefined,
  };
}

function runsOf(rows: ListedRow[]): ListGroup[] {
  const runs: ListGroup[] = [];
  for (const row of rows) {
    const last = runs.at(-1);
    if (last?.key === row.group_key) last.length += 1;
    else runs.push({ key: row.group_key, total: Number(row.group_total), length: 1 });
  }
  return runs;
}

export function createListing({ db }: Database) {
  async function facets(collectionId: string): Promise<Facets> {
    const [periods, genres] = await Promise.all([
      db.execute<{ period: number; count: string }>(sql`
        select r.original_year / 10 * 10 as period, count(*) as count
        from copies c join releases r on r.discogs_release_id = c.discogs_release_id
        where c.collection_id = ${collectionId} and r.original_year is not null
        group by 1 order by 1`),
      db.execute<{ genre: string; count: string }>(sql`
        select genre, count(*) as count
        from copies c join releases r on r.discogs_release_id = c.discogs_release_id, unnest(r.genres) genre
        where c.collection_id = ${collectionId}
        group by genre order by count(*) desc, genre`),
    ]);
    return {
      periods: periods.rows.map(({ period, count }) => ({ period: Number(period), count: Number(count) })),
      genres: genres.rows.map(({ genre, count }) => ({ genre, count: Number(count) })),
    };
  }

  async function page(collectionId: string, currency: Currency, query: ListQuery) {
    const sort = sorts[query.sort];
    const keys = sort.keys(query.direction);
    const filters = [
      sql`c.collection_id = ${collectionId}`,
      searchCondition(query.search),
      query.period === null ? sql`true` : sql`r.original_year >= ${query.period} and r.original_year < ${query.period + 10}`,
      query.genre === null ? sql`true` : sql`${query.genre} = any(r.genres)`,
    ];
    const order = sql.join(
      keys.map((key, index) => sql`${keyColumn(index)} ${sql.raw(key.direction)}`),
      sql`, `,
    );
    const [result, offered] = await Promise.all([
      db.execute<ListedRow>(sql`
      with matching as (
        select c.id, c.created_at, c.media_condition, r.original_year, r.artist_sort_key as artist_key, lower(r.title) as title_key
        from copies c join releases r on r.discogs_release_id = c.discogs_release_id
        where ${sql.join(filters, sql` and `)}
      ), valued as (
        ${
          sort.usesValue
            ? sql`select m.*, v.value from matching m left join lateral (${latestSnapshot(sql`m`, currency)}) v on true`
            : sql`select matching.*, null::numeric as value from matching`
        }
      ), keyed as (
        select id, ${sort.group} as group_key, ${sql.join(
          keys.map((key, index) => sql`${key.column} as ${keyColumn(index)}`),
          sql`, `,
        )}
        from valued
      ), groups as (
        select group_key, count(*) as group_total from keyed group by group_key
      ), page as (
        select * from keyed
        where ${query.after ? after(keys, query.after) : sql`true`}
        order by ${order}
        limit ${query.limit + 1}
      )
      select c.id, c.collection_id, c.media_condition, c.sleeve_condition, c.note, c.purchase_price, c.purchase_currency, c.purchase_date::text as purchase_date, c.created_at,
        r.discogs_release_id, r.artist, r.title, r.label, r.catalog_number, r.country, r.pressing_year, r.original_year,
        r.cover_image_url, r.genres, r.styles, r.fetched_at as release_fetched_at,
        v.media_condition as value_media_condition, v.value, v.lowest_listing, v.currency as value_currency, v.fetched_at as value_fetched_at,
        page.group_key, groups.group_total, (select sum(group_total) from groups) as total,
        array[${sql.join(
          keys.map((_, index) => sql`${keyColumn(index)}::text`),
          sql`, `,
        )}] as cursor_values
      from page
      join groups on groups.group_key = page.group_key
      join copies c on c.id = page.id
      join releases r on r.discogs_release_id = c.discogs_release_id
      left join lateral (${latestSnapshot(sql`c`, currency)}) v on true
      order by ${order}`),
      query.after ? null : facets(collectionId),
    ]);
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      listed: rows.map(listedCopy),
      total: Number(rows[0]?.total ?? 0),
      groups: runsOf(rows),
      next: result.rows.length > query.limit && last ? encodeCursor(query.sort, query.direction, last.cursor_values) : null,
      facets: offered,
    };
  }

  return { page };
}
