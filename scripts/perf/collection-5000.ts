import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { createApp } from "../../src/server/app.ts";
import { connectDatabase, migrate } from "../../src/server/db.ts";
import { createFixedRates } from "../../src/server/exchange-rates.ts";
import { createFakeDiscogs } from "../../src/server/fake-discogs.ts";
import { createSecretBox } from "../../src/server/secret-box.ts";
import { freePort } from "../../test/support/free-port.ts";

// Seeds Collections of 5,000 Copies each straight into PostgreSQL (with other Users' Collections beside them),
// then times GET /copies through the app for searches, sorts and filters, and prints the query plans.
// Usage: node scripts/perf/collection-5000.ts [copiesPerCollection=5000] [collections=5] [runs=50]
const [copiesPerCollection = 5000, collectionCount = 5, runs = 50] = process.argv.slice(2).map(Number);

const port = await freePort();
const password = randomUUID();
const dir = await mkdtemp(join(tmpdir(), "lp-collection-perf-"));
const logs: string[] = [];
const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password, port, persistent: false, postgresFlags: ["-c", "unix_socket_directories="], onLog: (line) => logs.push(String(line)) });
await server.initialise();
await server.start();
await server.createDatabase("perf");
const url = `postgres://postgres:${password}@localhost:${port}/perf`;
const database = connectDatabase(url);
await migrate(database);
const admin = new pg.Client({ connectionString: url });
await admin.connect();

const discogs = createFakeDiscogs();
const secretBox = createSecretBox(randomBytes(32));
const app = createApp({
  database,
  discogs,
  exchangeRates: createFixedRates(),
  secretBox,
  now: () => new Date(),
  appOwnerDiscogsUsername: "owner",
  publicUrl: new URL("http://localhost"),
});

async function logIn(discogsUsername: string, invite?: string) {
  const start = await app.request(invite ? `/api/login?invite=${invite}` : "/api/login");
  const loginCookie = start.headers.getSetCookie().find((cookie) => cookie.startsWith("lp_login="))!.split(";")[0]!;
  const callback = await app.request(discogs.authorizeAs(start.headers.get("location")!, discogsUsername), { headers: { cookie: loginCookie } });
  const session = callback.headers.getSetCookie().find((cookie) => cookie.startsWith("lp_session="))!.split(";")[0]!;
  const me = (await (await app.request("/api/me", { headers: { cookie: session } })).json()) as { collection: { id: string } };
  return { session, collectionId: me.collection.id };
}

const owner = await logIn("owner");
const others = [];
for (let index = 1; index < collectionCount; index++) {
  const { url: inviteUrl } = (await (await app.request("/api/invites", { method: "POST", headers: { cookie: owner.session } })).json()) as { url: string };
  others.push(await logIn(`collector-${index}`, inviteUrl.split("/invite/")[1]));
}

const seedStarted = performance.now();
for (const [index, { collectionId }] of [owner, ...others].entries()) {
  await admin.query(
    `
    with seeded as (
      select n, $2::int * 1000000 + n as release_id from generate_series(1, $1::int) n
    ), inserted_releases as (
      insert into releases (discogs_release_id, artist, title, label, catalog_number, country, pressing_year, original_year, cover_image_url, genres, styles, fetched_at)
      select release_id,
        (array['The ', '', '', ''])[1 + n % 4] || 'Artist ' || (n * 7919 % 900),
        'Album ' || md5(n::text || $2::text),
        'Label ' || (n % 120),
        upper(substr(md5(n::text), 1, 3)) || ' ' || (10000 + n),
        'UK',
        case when n % 20 = 0 then null else 1950 + n % 75 + n % 3 end,
        case when n % 20 = 0 then null else 1950 + n % 75 end,
        null,
        array[(array['Rock','Jazz','Electronic','Pop','Funk / Soul','Classical','Hip Hop','Folk, World, & Country','Blues','Reggae','Latin','Stage & Screen'])[1 + n % 12]]
          || case when n % 5 = 0 then array['Pop'] else array[]::text[] end,
        array['Style ' || (n % 60)],
        now()
      from seeded
      returning discogs_release_id
    ), inserted_copies as (
      insert into copies (collection_id, discogs_release_id, created_at)
      select $3::uuid, discogs_release_id, now() - make_interval(mins => (discogs_release_id % 1000000)::int)
      from inserted_releases
      returning id, discogs_release_id
    )
    insert into value_snapshots (copy_id, media_condition, value, lowest_listing, currency, fetched_at)
    select c.id, 'Very Good Plus (VG+)', case when c.discogs_release_id % 10 = 0 then null else round((20 + (c.discogs_release_id * 37 % 3000))::numeric * (1 + s.k * 0.05), 2) end, 50, 'DKK', now() - make_interval(days => 60 - s.k * 30)
    from inserted_copies c, generate_series(0, 1) s(k)
    where c.discogs_release_id % 25 <> 0`,
    [copiesPerCollection, index + 1, collectionId],
  );
}
await admin.query("vacuum analyze");
const counts = await admin.query("select (select count(*) from copies) copies, (select count(*) from releases) releases, (select count(*) from value_snapshots) snapshots");
console.log(`seeded ${JSON.stringify(counts.rows[0])} in ${Math.round(performance.now() - seedStarted)} ms`);

type Page = { copies: unknown[]; total: number; next: string | null };

async function get(query: Record<string, string>) {
  const response = await app.request(`/api/collections/${owner.collectionId}/copies?${new URLSearchParams(query)}`, { headers: { cookie: owner.session } });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return (await response.json()) as Page;
}

const scenarios: Record<string, Record<string, string>> = {
  "first page, Value high first (the default)": {},
  "search + sort + filter: q=artist 1, sort=artist, genre=Rock": { q: "artist 1", sort: "artist", genre: "Rock" },
  "search + sort + filter: q=label, sort=value asc, period=1970, genre=Pop": { q: "label", sort: "value", dir: "asc", period: "1970", genre: "Pop" },
  "search by Catalog number without spaces": { q: "c4c10042" },
  "search that matches nothing": { q: "no such record" },
  "Period sort": { sort: "period" },
};

function percentile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

const results: Record<string, unknown> = {};
for (const [name, query] of Object.entries(scenarios)) {
  for (let warm = 0; warm < 5; warm++) await get(query);
  const times: number[] = [];
  let page: Page | undefined;
  for (let run = 0; run < runs; run++) {
    const started = performance.now();
    page = await get(query);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  results[name] = { rows: page!.copies.length, total: page!.total, p50: +percentile(times, 0.5).toFixed(1), p95: +percentile(times, 0.95).toFixed(1), max: +times.at(-1)!.toFixed(1) };
}

let cursor: string | null = null;
let pages = 0;
const walkStarted = performance.now();
const seen = new Set<string>();
do {
  const page: Page = await get(cursor ? { cursor } : {});
  for (const copy of page.copies as { id: string }[]) seen.add(copy.id);
  cursor = page.next;
  pages += 1;
} while (cursor);
results["every page of the default sort, 50 per page"] = { pages, distinctCopies: seen.size, totalMs: Math.round(performance.now() - walkStarted) };

console.log(JSON.stringify({ copiesPerCollection, collectionCount, runs, results }, null, 2));

await admin.query("alter database perf set session_preload_libraries = 'auto_explain'");
await admin.query("alter database perf set auto_explain.log_min_duration = 0");
await admin.query("alter database perf set auto_explain.log_analyze = on");
await admin.query("alter database perf set auto_explain.log_buffers = on");
const explained = connectDatabase(url);
const explainApp = createApp({ database: explained, discogs, exchangeRates: createFixedRates(), secretBox, now: () => new Date(), appOwnerDiscogsUsername: "owner", publicUrl: new URL("http://localhost") });
for (const name of process.env.EXPLAIN ? process.env.EXPLAIN.split(",") : ["search + sort + filter: q=artist 1, sort=artist, genre=Rock"]) {
  logs.length = 0;
  await explainApp.request(`/api/collections/${owner.collectionId}/copies?${new URLSearchParams(scenarios[name]!)}`, { headers: { cookie: owner.session } });
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log(`--- plans for ${name}`);
  console.log(logs.filter((line) => line.includes("duration") || line.includes("->") || line.includes("Execution") || line.includes("Index") || line.includes("Filter")).join("\n"));
}

await explained.close();
await admin.end();
await database.close();
await server.stop();
await rm(dir, { recursive: true, force: true });
