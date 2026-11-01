import { expect, test } from "vitest";
import { createFixedRates } from "../../src/server/exchange-rates.ts";
import { priceLadder, type FakeRelease } from "../../src/server/fake-discogs.ts";
import { createRefresh } from "../../src/server/refresh.ts";
import { invitedFriend, logInWithCollection, saveCopy, type Member, type TestApp } from "../support/members.ts";
import { createTestApp, days } from "../support/test-app.ts";

type Overview = {
  copies: number;
  collectionValue?: { amount: number; currency: string };
  mostValuable?: { id: string; release: { title: string }; value: { value: number | null } | null }[];
  history?: { recordedAt: string; value: number }[];
};

const releases: FakeRelease[] = Array.from({ length: 13 }, (_, index) => ({
  discogsReleaseId: index + 1,
  artist: "Artist",
  title: `LP ${index + 1}`,
  label: null,
  catalogNumber: null,
  country: null,
  pressingYear: null,
  originalYear: null,
  coverImageUrl: null,
  format: null,
  genres: [],
  styles: [],
  barcodes: [],
}));

/** LP 1 to LP 12 are worth 10 to 120 euro at Near Mint; LP 13 has no Value. */
const prices = () => Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, priceLadder((index + 1) * 10)]));

async function collectionOfThirteen() {
  const discogs = { releases, prices: prices() };
  const app = await createTestApp({ discogs });
  const owner = await logInWithCollection(app);
  for (const { discogsReleaseId } of releases) expect((await saveCopy(owner, discogsReleaseId)).status).toBe(201);
  return { app, owner, discogs };
}

async function overview(user: Member) {
  const response = await user.as("/overview");
  expect(response.status).toBe(200);
  return (await response.json()) as Overview;
}

function refresh(app: TestApp) {
  return createRefresh({ database: app.database, discogs: app.discogs, exchangeRates: createFixedRates(), secretBox: app.secretBox, now: app.now, wait: async () => {} }).run();
}

test("the overview counts the Copies, sums the Collection value with no Value as zero, and lists the ten most valuable", async () => {
  const { owner } = await collectionOfThirteen();

  const { copies, collectionValue, mostValuable, history } = await overview(owner);

  expect(copies).toBe(13);
  // VG+ is 0.75 of Near Mint, and a euro is 7.46 kroner: 0.75 × 7.46 × (10 + 20 + … + 120) = 4364.1.
  expect(collectionValue).toEqual({ amount: 4364.1, currency: "DKK" });
  expect(mostValuable!.map((copy) => copy.release.title)).toEqual(["LP 12", "LP 11", "LP 10", "LP 9", "LP 8", "LP 7", "LP 6", "LP 5", "LP 4", "LP 3"]);
  expect(mostValuable![0]).toMatchObject({ id: expect.any(String), value: { value: 671.4 } });
  expect(history).toEqual([]);
});

test("the overview's history is the Collection value at each monthly refresh, oldest first", async () => {
  const { app, owner, discogs } = await collectionOfThirteen();
  await refresh(app);
  discogs.prices[12] = priceLadder(240);
  app.clock.advance(days(31));
  await refresh(app);

  const { history, collectionValue } = await overview(owner);

  expect(history).toEqual([
    { recordedAt: "2026-03-01T12:00:00.000Z", value: 4364.1 },
    { recordedAt: "2026-04-01T12:00:00.000Z", value: 5035.5 },
  ]);
  expect(collectionValue).toEqual({ amount: 5035.5, currency: "DKK" });
});

test("an empty Collection's overview is zero Copies worth zero", async () => {
  const app = await createTestApp();
  const owner = await logInWithCollection(app);

  expect(await overview(owner)).toEqual({ copies: 0, collectionValue: { amount: 0, currency: "DKK" }, mostValuable: [], history: [] });
});

test("with Values hidden the overview is only the number of Copies", async () => {
  const { app, owner } = await collectionOfThirteen();
  await app.request("/api/me/show-values", { method: "PUT", headers: { cookie: owner.session, "content-type": "application/json" }, body: JSON.stringify({ showValues: false }) });

  expect(await overview(owner)).toEqual({ copies: 13 });
});

test("only Members see a Collection's overview", async () => {
  const { app, owner } = await collectionOfThirteen();
  const stranger = await invitedFriend(app, owner.session, "stranger");

  expect((await app.request(`/api/collections/${owner.collectionId}/overview`)).status).toBe(401);
  expect((await app.request(`/api/collections/${owner.collectionId}/overview`, { headers: { cookie: stranger.session } })).status).toBe(404);
});
