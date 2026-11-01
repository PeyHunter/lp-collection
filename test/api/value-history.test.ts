import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { createFixedRates } from "../../src/server/exchange-rates.ts";
import { priceLadder, type FakeDiscogsScript, type FakeRelease } from "../../src/server/fake-discogs.ts";
import { createRefresh, type RefreshOptions } from "../../src/server/refresh.ts";
import { invitedFriend, logInWithCollection, saveCopy, type Member, type TestApp } from "../support/members.ts";
import { createTestApp, days } from "../support/test-app.ts";

function release(discogsReleaseId: number, title: string): FakeRelease {
  return { discogsReleaseId, artist: "Gasolin'", title, label: null, catalogNumber: null, country: null, pressingYear: null, originalYear: 1975, coverImageUrl: null, format: null, genres: [], styles: [], barcodes: [] };
}

type History = { recordedAt: string; mediaCondition: string; value: number | null }[];
type CopyAnswer = { copy: { id: string; value?: { value: number | null } }; valueHistory?: History };

function refresh(app: TestApp, options: Partial<RefreshOptions> = {}) {
  return createRefresh({ database: app.database, discogs: app.discogs, exchangeRates: createFixedRates(), secretBox: app.secretBox, now: app.now, wait: async () => {}, ...options });
}

async function copy(user: Member, id: string) {
  const { copy, valueHistory } = (await (await user.as(`/copies/${id}`)).json()) as CopyAnswer;
  return { ...copy, valueHistory };
}

async function saved(user: Member, discogsReleaseId: number) {
  return ((await (await saveCopy(user, discogsReleaseId)).json()) as CopyAnswer).copy.id;
}

async function collectionHistory(app: TestApp) {
  return app.query<{ collection_id: string; month: string; value: string; copies: number; currency: string }>(
    `select v.collection_id, r.month, v.value::text as value, v.copies, v.currency from collection_values v join value_refreshes r on r.id = v.refresh_id order by r.month, v.collection_id`,
  );
}

async function twoCollections(discogs: FakeDiscogsScript) {
  const app = await createTestApp({ discogs });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  const gas5 = await saved(owner, 5);
  const debut = await saved(owner, 6);
  const priceless = await saved(owner, 7);
  const friendsCopy = await saved(friend, 5);
  return { app, owner, friend, ids: { gas5, debut, priceless, friendsCopy } };
}

const script = (): FakeDiscogsScript => ({
  releases: [release(5, "Gas 5"), release(6, "Gasolin'"), release(7, "Demo")],
  prices: { 5: priceLadder(100), 6: priceLadder(40) },
});

test("a refresh records a Value per Copy and the Collection value, counting Copies with no Value as zero", async () => {
  const discogs = script();
  const { app, owner, friend, ids } = await twoCollections(discogs);
  discogs.prices![5] = priceLadder(120);
  app.clock.advance(days(1));

  expect(await refresh(app).run()).toEqual({ month: "2026-03", collections: 2, copies: 4, finished: true });

  const gas5 = await copy(owner, ids.gas5);
  expect(gas5.value?.value).toBe(671.4);
  expect(gas5.valueHistory).toEqual([{ recordedAt: "2026-03-02T12:00:00.000Z", mediaCondition: "Very Good Plus (VG+)", value: 671.4 }]);
  expect((await copy(owner, ids.priceless)).valueHistory).toEqual([{ recordedAt: "2026-03-02T12:00:00.000Z", mediaCondition: "Very Good Plus (VG+)", value: null }]);
  expect(await collectionHistory(app)).toEqual(
    expect.arrayContaining([
      { collection_id: owner.collectionId, month: "2026-03", value: "895.20", copies: 3, currency: "DKK" },
      { collection_id: friend.collectionId, month: "2026-03", value: "671.40", copies: 1, currency: "DKK" },
    ]),
  );
});

test("the Value history grows by one entry each month, and a second run in the same month changes nothing", async () => {
  const discogs = script();
  const { app, owner, ids } = await twoCollections(discogs);
  await refresh(app).run();
  const requestsAfterMarch = app.discogs.requests.length;

  expect(await refresh(app).run()).toEqual({ month: "2026-03", collections: 0, copies: 0, finished: true });
  expect(app.discogs.requests).toHaveLength(requestsAfterMarch);

  discogs.prices![5] = priceLadder(80);
  app.clock.advance(days(31));
  await refresh(app).run();

  expect((await copy(owner, ids.gas5)).valueHistory!.map((entry) => entry.value)).toEqual([559.5, 447.6]);
  expect((await collectionHistory(app)).filter((row) => row.collection_id === owner.collectionId).map((row) => [row.month, row.value])).toEqual([
    ["2026-03", "783.30"],
    ["2026-04", "671.40"],
  ]);
});

test("a refresh that stops halfway carries on where it stopped, valuing each Copy once", async () => {
  const { app, owner } = await twoCollections(script());
  let calls = 0;
  const crashing = refresh(app, {
    wait: async () => {
      calls += 1;
      if (calls === 3) throw new Error("the pod was killed");
    },
  });

  await expect(crashing.run()).rejects.toThrow("the pod was killed");
  const priceRequestsBefore = app.discogs.requests.filter((request) => request.endpoint === "price-suggestions").length;
  expect(await refresh(app).run()).toMatchObject({ month: "2026-03", finished: true });

  const refreshed = await app.query<{ copy_id: string; snapshots: string }>(
    `select copy_id, count(*)::text as snapshots from value_snapshots where refresh_id is not null group by copy_id`,
  );
  expect(refreshed).toHaveLength(4);
  expect(refreshed.every((row) => row.snapshots === "1")).toBe(true);
  expect(app.discogs.requests.filter((request) => request.endpoint === "price-suggestions").length - priceRequestsBefore).toBe(2);
  expect((await collectionHistory(app)).filter((row) => row.collection_id === owner.collectionId)).toHaveLength(1);
});

test("each Owner's Copies are valued with that Owner's Discogs account, paced to stay inside its rate limit", async () => {
  const { app } = await twoCollections(script());
  const waits: number[] = [];

  await refresh(app, { wait: async (ms) => void waits.push(ms) }).run();

  expect(waits).toEqual([2400, 2400, 2400, 2400]);
  const tokens = new Set(app.discogs.requests.filter((request) => request.endpoint === "price-suggestions").map((request) => request.token));
  expect(tokens.size).toBe(2);
});

test("a Collection whose Owner has no seller settings is skipped and the month stays open for it, while the others are refreshed", async () => {
  const discogs = { ...script(), sellerSettingsMissingFor: (username: string) => username === "friend" };
  const { app, owner } = await twoCollections(discogs);

  expect(await refresh(app).run()).toMatchObject({ collections: 1, finished: false });

  expect((await collectionHistory(app)).map((row) => row.collection_id)).toEqual([owner.collectionId]);
});

test("the Value history is left out while the User hides Values", async () => {
  const { app, owner, ids } = await twoCollections(script());
  await refresh(app).run();
  await app.request("/api/me/show-values", { method: "PUT", headers: { cookie: owner.session, "content-type": "application/json" }, body: JSON.stringify({ showValues: false }) });

  expect(await (await owner.as(`/copies/${ids.gas5}`)).json()).not.toHaveProperty("valueHistory");
});

test("`main.ts refresh` runs one refresh and exits, as the monthly CronJob does", async () => {
  const app = await createTestApp();

  const result = spawnSync(process.execPath, ["src/server/main.ts", "refresh"], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: app.databaseUrl, DISCOGS: "fake", APP_OWNER_DISCOGS_USERNAME: "owner" },
    encoding: "utf8",
    timeout: 30_000,
  });

  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/Refresh \d{4}-\d{2}: 0 Values fetched, 0 Collection values recorded, month finished\./);
  expect(await app.query("select finished_at is not null as finished from value_refreshes")).toEqual([{ finished: true }]);
});
