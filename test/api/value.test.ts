import { expect, test } from "vitest";
import type { CopyView } from "../../src/server/collection.ts";
import { priceLadder, sampleReleases, type FakeDiscogsScript } from "../../src/server/fake-discogs.ts";
import { invitedFriend, listCopies, logInWithCollection, saveCopy, type Member } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

const discovery = 16893476;
const gas5 = 1503928;

const priced: FakeDiscogsScript = {
  releases: sampleReleases,
  prices: { [discovery]: priceLadder(40) },
  lowestListings: { [discovery]: { amount: 31, currency: "EUR" } },
  sellerSettingsMissingFor: ["no-seller-settings"],
};

type CopyAnswer = { copy: CopyView; sellerSettingsMissing: boolean };

async function saved(user: Member, discogsReleaseId: number) {
  const response = await saveCopy(user, discogsReleaseId);
  expect(response.status).toBe(201);
  return (await response.json()) as CopyAnswer;
}

async function changeConditions(user: Member, copyId: string, conditions: Record<string, unknown>) {
  return user.as(`/copies/${copyId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(conditions) });
}

function priceRequests(app: Awaited<ReturnType<typeof createTestApp>>) {
  return app.discogs.requests
    .filter((request) => request.endpoint === "price-suggestions" || request.endpoint === "stats")
    .map(({ token: _, secret: __, ...request }) => request);
}

test("a saved Copy shows the Discogs suggested price for its Media condition and the Lowest listing, in kroner by default", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);

  const { copy, sellerSettingsMissing } = await saved(owner, discovery);

  expect(sellerSettingsMissing).toBe(false);
  expect(copy.value).toEqual({
    mediaCondition: "Very Good Plus (VG+)",
    value: 223.8,
    lowestListing: 231.26,
    currency: "DKK",
    fetchedAt: "2026-03-01T12:00:00.000Z",
  });
  expect(await listCopies(owner)).toEqual([copy]);
  const detail = await owner.as(`/copies/${copy.id}`);
  expect(((await detail.json()) as CopyAnswer).copy).toEqual(copy);
});

test("Discogs is asked for the Lowest listing in euros when it can't quote the User's currency, and in the User's currency when it can", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const me = await app.request("/api/me", { headers: { cookie: owner.session } });
  expect(await me.json()).toMatchObject({ currency: "DKK" });

  await saved(owner, discovery);
  const changed = await app.request("/api/me/currency", {
    method: "PUT",
    headers: { cookie: owner.session, "content-type": "application/json" },
    body: JSON.stringify({ currency: "USD" }),
  });
  const { copy } = await saved(owner, discovery);

  expect(changed.status).toBe(200);
  expect(copy.value).toMatchObject({ value: 33, lowestListing: 34.1, currency: "USD" });
  expect(priceRequests(app)).toEqual([
    { endpoint: "price-suggestions", discogsReleaseId: discovery },
    { endpoint: "stats", discogsReleaseId: discovery, currency: "EUR" },
    { endpoint: "price-suggestions", discogsReleaseId: discovery },
    { endpoint: "stats", discogsReleaseId: discovery, currency: "USD" },
  ]);
});

test("a currency the app doesn't know is refused", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);

  const responses = await Promise.all(
    ["dkk", "XYZ", 42].map((currency) =>
      app.request("/api/me/currency", {
        method: "PUT",
        headers: { cookie: owner.session, "content-type": "application/json" },
        body: JSON.stringify({ currency }),
      }),
    ),
  );

  expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
  expect(await (await app.request("/api/me", { headers: { cookie: owner.session } })).json()).toMatchObject({ currency: "DKK" });
});

test("a Release Discogs has no price suggestion for has no Value yet but stays in the Collection with its Lowest listing", async () => {
  const app = await createTestApp({ discogs: { ...priced, lowestListings: { [gas5]: { amount: 12, currency: "EUR" } } } });
  const owner = await logInWithCollection(app);

  const { copy } = await saved(owner, gas5);

  expect(copy.value).toMatchObject({ value: null, lowestListing: 89.52, currency: "DKK" });
  expect(await listCopies(owner)).toEqual([copy]);
});

test("a missing Lowest listing leaves only the Value", async () => {
  const app = await createTestApp({ discogs: { ...priced, lowestListings: {} } });
  const owner = await logInWithCollection(app);

  const { copy } = await saved(owner, discovery);

  expect(copy.value).toMatchObject({ value: 223.8, lowestListing: null });
});

test("changing the Media condition fetches the Value for the new condition at once and keeps each fetch as a snapshot", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const { copy } = await saved(owner, discovery);

  app.clock.advance(60_000);
  const nearMint = await changeConditions(owner, copy.id, { mediaCondition: "Near Mint (NM or M-)" });
  app.clock.advance(60_000);
  const good = await changeConditions(owner, copy.id, { mediaCondition: "Good (G)" });

  expect(nearMint.status).toBe(200);
  expect(((await nearMint.json()) as CopyAnswer).copy).toMatchObject({
    mediaCondition: "Near Mint (NM or M-)",
    value: { mediaCondition: "Near Mint (NM or M-)", value: 298.4, currency: "DKK", fetchedAt: "2026-03-01T12:01:00.000Z" },
  });
  expect(((await good.json()) as CopyAnswer).copy.value).toMatchObject({ mediaCondition: "Good (G)", value: 65.65 });
  expect(await listCopies(owner)).toMatchObject([{ mediaCondition: "Good (G)", value: { value: 65.65 } }]);
  const snapshots = await app.query("SELECT media_condition, value, currency FROM value_snapshots ORDER BY fetched_at");
  expect(snapshots).toEqual([
    { media_condition: "Very Good Plus (VG+)", value: "223.80", currency: "DKK" },
    { media_condition: "Near Mint (NM or M-)", value: "298.40", currency: "DKK" },
    { media_condition: "Good (G)", value: "65.65", currency: "DKK" },
  ]);
});

test("the Sleeve condition takes the Discogs sleeve grades and changing it alone asks Discogs nothing", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const { copy } = await saved(owner, discovery);
  const asked = app.discogs.requests.length;

  const response = await changeConditions(owner, copy.id, { sleeveCondition: "No Cover" });

  expect(response.status).toBe(200);
  expect(((await response.json()) as CopyAnswer).copy).toMatchObject({ sleeveCondition: "No Cover", value: { value: 223.8 } });
  expect(app.discogs.requests).toHaveLength(asked);
});

test("a condition that isn't on the Discogs scale is refused and changes nothing", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const { copy } = await saved(owner, discovery);

  const responses = await Promise.all(
    [{}, { mediaCondition: "No Cover" }, { mediaCondition: "VG+" }, { sleeveCondition: "Shiny" }].map((body) => changeConditions(owner, copy.id, body)),
  );

  expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
  expect(await listCopies(owner)).toEqual([copy]);
});

test("when Discogs refuses because the seller settings are missing, the User is told so instead of every Copy showing No Value yet, until they fill them in", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "no-seller-settings");

  const first = await saved(friend, discovery);
  app.clock.advance(60_000);
  const second = await saved(friend, gas5);
  const list = await friend.as("/copies");
  const me = await app.request("/api/me", { headers: { cookie: friend.session } });

  expect([first.sellerSettingsMissing, second.sellerSettingsMissing]).toEqual([true, true]);
  expect([first.copy.value, second.copy.value]).toEqual([null, null]);
  expect(await list.json()).toMatchObject({ sellerSettingsMissing: true });
  expect(await me.json()).toMatchObject({ sellerSettingsUrl: "/fake-discogs/settings/seller" });
  expect(await app.query("SELECT * FROM value_snapshots")).toEqual([]);

  app.discogs.fillInSellerSettings("no-seller-settings");
  const retried = await friend.as("/values", { method: "POST" });

  expect(retried.status).toBe(200);
  const { copies, sellerSettingsMissing } = (await retried.json()) as { copies: CopyView[]; sellerSettingsMissing: boolean };
  expect(sellerSettingsMissing).toBe(false);
  expect(copies.map((copy) => copy.value?.value)).toEqual([null, 223.8]);
  expect(await (await friend.as("/copies")).json()).toMatchObject({ sellerSettingsMissing: false });
});

test("the owner's prices don't depend on another User's missing seller settings", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "no-seller-settings");

  await saved(friend, discovery);
  const { copy, sellerSettingsMissing } = await saved(owner, discovery);

  expect(sellerSettingsMissing).toBe(false);
  expect(copy.value).toMatchObject({ value: 223.8 });
});

test("when Discogs can't be reached for prices the Copy is still saved, with no Value yet", async () => {
  const script: FakeDiscogsScript = { ...priced };
  const app = await createTestApp({ discogs: script });
  const owner = await logInWithCollection(app);
  await saved(owner, discovery);

  script.unavailable = true;
  const { copy, sellerSettingsMissing } = await saved(owner, discovery);

  expect(sellerSettingsMissing).toBe(false);
  expect(copy.value).toBeNull();
  expect(await listCopies(owner)).toHaveLength(2);
});

test("only Members see a Copy, change its conditions or fetch its Values", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  const { copy } = await saved(owner, discovery);
  const intoOwners = (path: string, init: RequestInit = {}) =>
    app.request(`/api/collections/${owner.collectionId}${path}`, { ...init, headers: { cookie: friend.session, ...init.headers } });

  const responses = [
    await intoOwners(`/copies/${copy.id}`),
    await intoOwners(`/copies/${copy.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaCondition: "Poor (P)" }),
    }),
    await intoOwners("/values", { method: "POST" }),
    await friend.as(`/copies/${copy.id}`),
    await changeConditions(friend, copy.id, { mediaCondition: "Poor (P)" }),
    await app.request(`/api/collections/${owner.collectionId}/copies/${copy.id}`),
  ];

  expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 401]);
  expect(await listCopies(owner)).toMatchObject([{ mediaCondition: "Very Good Plus (VG+)", value: { value: 223.8 } }]);
});
