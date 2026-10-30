import { expect, test } from "vitest";
import type { CopyView } from "../../src/server/collection.ts";
import { priceLadder, sampleReleases, type FakeDiscogsScript } from "../../src/server/fake-discogs.ts";
import { invitedFriend, listCopies, logInWithCollection, saveCopy, type Member } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

const discovery = 16893476;
const gas5 = 1503928;
const kindOfBlueEurope = 2474032;

const priced: FakeDiscogsScript = {
  releases: sampleReleases,
  prices: { [discovery]: priceLadder(40) },
  lowestListings: { [discovery]: { amount: 31, currency: "EUR" } },
  sellerSettingsMissingFor: (discogsUsername) => discogsUsername === "no-seller-settings",
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

type ValuesAnswer = { copies: CopyView[]; sellerSettingsMissing: boolean; more: boolean; retryEmptyBefore?: string };

async function fetchValues(user: Member, body?: object) {
  const response = await user.as("/values", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ValuesAnswer;
}

function priceSuggestionsAsked(app: Awaited<ReturnType<typeof createTestApp>>) {
  return app.discogs.requests.filter((request) => request.endpoint === "price-suggestions").map((request) => request.discogsReleaseId);
}

test("a Media condition change while Discogs is unreachable shows no Value instead of the old condition's", async () => {
  const script: FakeDiscogsScript = { ...priced };
  const app = await createTestApp({ discogs: script });
  const owner = await logInWithCollection(app);
  const { copy } = await saved(owner, discovery);

  script.unavailable = true;
  const changed = await changeConditions(owner, copy.id, { mediaCondition: "Near Mint (NM or M-)" });

  expect(((await changed.json()) as CopyAnswer).copy).toMatchObject({ mediaCondition: "Near Mint (NM or M-)", value: null });
  expect(await listCopies(owner)).toMatchObject([{ mediaCondition: "Near Mint (NM or M-)", value: null }]);
});

test("Copies with no Value for their Media condition get one a few at a time, and a Release with no suggestion isn't asked again", async () => {
  const script: FakeDiscogsScript = { ...priced };
  const app = await createTestApp({ discogs: script });
  const owner = await logInWithCollection(app);
  await saved(owner, gas5);
  await saved(owner, discovery);
  script.unavailable = true;
  for (let saves = 0; saves < 7; saves++) await saved(owner, discovery);
  script.unavailable = false;
  app.discogs.requests.length = 0;

  const first = await fetchValues(owner);
  const second = await fetchValues(owner);
  const third = await fetchValues(owner);

  expect([first.more, second.more, third.more]).toEqual([true, false, false]);
  expect(first.copies.map((copy) => copy.value?.value)).toEqual(Array(5).fill(223.8));
  const list = (await listCopies(owner)) as CopyView[];
  const valuesOf = (discogsReleaseId: number) =>
    list.filter((copy) => copy.release.discogsReleaseId === discogsReleaseId).map((copy) => copy.value?.value);
  expect([valuesOf(discovery), valuesOf(gas5)]).toEqual([Array(8).fill(223.8), [null]]);
  expect(priceSuggestionsAsked(app)).toEqual(Array(7).fill(discovery));
});

test("Values are fetched once when the list asks for them twice at the same time", async () => {
  const script: FakeDiscogsScript = { ...priced };
  const app = await createTestApp({ discogs: script });
  const owner = await logInWithCollection(app);
  await saved(owner, discovery);
  script.unavailable = true;
  await saved(owner, discovery);
  await saved(owner, discovery);
  Object.assign(script, { unavailable: false, priceSuggestionsDelayMs: 100 });
  app.discogs.requests.length = 0;

  const answers = await Promise.all([fetchValues(owner), fetchValues(owner)]);

  expect(answers.map((answer) => answer.copies.map((copy) => copy.value?.value))).toEqual([Array(2).fill(223.8), Array(2).fill(223.8)]);
  expect(((await listCopies(owner)) as CopyView[]).map((copy) => copy.value?.value)).toEqual(Array(3).fill(223.8));
  expect(priceSuggestionsAsked(app)).toEqual(Array(2).fill(discovery));
});

test("the seller settings guide fetches again the Copies that Discogs gave no Value, each once", async () => {
  const script: FakeDiscogsScript = { ...priced, prices: { ...priced.prices } };
  const app = await createTestApp({ discogs: script });
  const owner = await logInWithCollection(app);
  for (let saves = 0; saves < 3; saves++) await saved(owner, gas5);
  for (let saves = 0; saves < 3; saves++) await saved(owner, kindOfBlueEurope);
  script.prices![gas5] = priceLadder(20);
  app.clock.advance(60_000);
  app.discogs.requests.length = 0;

  expect((await fetchValues(owner)).more).toBe(false);
  expect(priceSuggestionsAsked(app)).toEqual([]);

  const first = await fetchValues(owner, { retryEmpty: true });
  app.clock.advance(60_000);
  const second = await fetchValues(owner, { retryEmptyBefore: first.retryEmptyBefore });
  const third = await fetchValues(owner, { retryEmptyBefore: first.retryEmptyBefore });

  expect([first.more, second.more, third.more]).toEqual([true, false, false]);
  const list = (await listCopies(owner)) as CopyView[];
  const valuesOf = (discogsReleaseId: number) =>
    list.filter((copy) => copy.release.discogsReleaseId === discogsReleaseId).map((copy) => copy.value?.value);
  expect([valuesOf(gas5), valuesOf(kindOfBlueEurope)]).toEqual([Array(3).fill(111.9), Array(3).fill(null)]);
  expect(priceSuggestionsAsked(app).sort()).toEqual([...Array(3).fill(gas5), ...Array(3).fill(kindOfBlueEurope)].sort());
});

test("after a currency change no Value shows in the old currency, and fetching gives every Copy its Value in the new one", async () => {
  const app = await createTestApp({ discogs: { ...priced, lowestListings: { ...priced.lowestListings, [gas5]: { amount: 12, currency: "EUR" } } } });
  const owner = await logInWithCollection(app);
  await saved(owner, discovery);
  app.clock.advance(60_000);
  await saved(owner, gas5);

  await app.request("/api/me/currency", {
    method: "PUT",
    headers: { cookie: owner.session, "content-type": "application/json" },
    body: JSON.stringify({ currency: "USD" }),
  });

  expect(await listCopies(owner)).toMatchObject([{ value: null }, { value: null }]);
  const { copies, more } = await fetchValues(owner);
  expect(more).toBe(false);
  expect(copies.map((copy) => copy.value)).toMatchObject([
    { value: null, lowestListing: 13.2, currency: "USD" },
    { value: 33, lowestListing: 34.1, currency: "USD" },
  ]);
});

test("a Copy whose Value keeps failing doesn't hold up the others, and isn't asked again until a while has passed", async () => {
  const script: FakeDiscogsScript = { ...priced };
  const app = await createTestApp({ discogs: script });
  const owner = await logInWithCollection(app);
  for (const discogsReleaseId of [discovery, discovery, discovery, kindOfBlueEurope]) {
    app.clock.advance(1_000);
    await saved(owner, discogsReleaseId);
  }
  await app.query("DELETE FROM value_snapshots");
  script.unavailableReleases = [kindOfBlueEurope];
  app.discogs.requests.length = 0;

  const first = await fetchValues(owner);
  const second = await fetchValues(owner);

  expect(first.copies.map((copy) => copy.value?.value)).toEqual([223.8, 223.8, 223.8]);
  expect(((await listCopies(owner)) as CopyView[]).map((copy) => copy.value?.value ?? null)).toEqual([223.8, 223.8, 223.8, null]);
  expect(second.more).toBe(false);
  expect(priceSuggestionsAsked(app)).toEqual([kindOfBlueEurope, discovery, discovery, discovery]);

  app.clock.advance(60 * 60_000);
  await fetchValues(owner);

  expect(priceSuggestionsAsked(app)).toEqual([kindOfBlueEurope, discovery, discovery, discovery, kindOfBlueEurope]);
});

test("Members of one Collection with different currencies each get every Value fetched once, even with the list open at the same time", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const invited = await invitedFriend(app, owner.session, "friend");
  const [friendId] = await app.query<{ user_id: string }>("SELECT user_id FROM memberships WHERE collection_id = $1", [invited.collectionId]);
  await app.query("INSERT INTO memberships (collection_id, user_id) VALUES ($1, $2)", [owner.collectionId, friendId!.user_id]);
  const friend: Member = {
    ...invited,
    collectionId: owner.collectionId,
    as: (path, init = {}) => app.request(`/api/collections/${owner.collectionId}${path}`, { ...init, headers: { cookie: invited.session, ...init.headers } }),
  };
  await app.request("/api/me/currency", {
    method: "PUT",
    headers: { cookie: invited.session, "content-type": "application/json" },
    body: JSON.stringify({ currency: "USD" }),
  });
  for (let saves = 0; saves < 3; saves++) await saved(owner, discovery);
  app.discogs.requests.length = 0;

  const opens = async (member: Member) => {
    for (let open = 0; open < 3; open++) await fetchValues(member);
    return listCopies(member);
  };
  const [ownersList, friendsList] = await Promise.all([opens(owner), opens(friend)]);
  await opens(owner);

  expect(ownersList).toMatchObject(Array(3).fill({ value: { value: 223.8, currency: "DKK" } }));
  expect(friendsList).toMatchObject(Array(3).fill({ value: { value: 33, currency: "USD" } }));
  expect(priceSuggestionsAsked(app)).toEqual(Array(3).fill(discovery));
});

test("a retry time later than now from the client counts as now, so the same Copies aren't fetched again on every ask", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  for (let saves = 0; saves < 7; saves++) await saved(owner, gas5);
  app.clock.advance(60_000);
  app.discogs.requests.length = 0;

  const answers = [];
  for (let asks = 0; asks < 3; asks++) answers.push(await fetchValues(owner, { retryEmptyBefore: "2099-01-01T00:00:00Z" }));

  expect(answers.map((answer) => answer.more)).toEqual([true, false, false]);
  expect(answers[0]!.retryEmptyBefore).toBe("2026-03-01T12:01:00.000Z");
  expect(priceSuggestionsAsked(app)).toEqual(Array(7).fill(gas5));
});
