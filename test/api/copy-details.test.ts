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
};

type CopyAnswer = { copy: CopyView; sellerSettingsMissing: boolean };

async function saved(user: Member, discogsReleaseId = discovery) {
  const response = await saveCopy(user, discogsReleaseId);
  expect(response.status).toBe(201);
  return ((await response.json()) as CopyAnswer).copy;
}

function change(user: Member, copyId: string, details: Record<string, unknown>) {
  return user.as(`/copies/${copyId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(details) });
}

async function changed(user: Member, copyId: string, details: Record<string, unknown>) {
  const response = await change(user, copyId, details);
  expect(response.status).toBe(200);
  return ((await response.json()) as CopyAnswer).copy;
}

async function copyPage(user: Member, copyId: string) {
  const response = await user.as(`/copies/${copyId}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as CopyAnswer).copy;
}

test("a new Copy has no note, Purchase price, purchase date or Gain", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);

  const copy = await saved(owner);

  expect(copy).toMatchObject({ note: null, purchasePrice: null, purchaseDate: null, gain: null });
});

test("a note, Purchase price and purchase date can be set, are shown in the Collection and on the Copy, and can be cleared", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const { id } = await saved(owner);

  const set = await changed(owner, id, {
    note: "  From Dad's shelf.\nSmall seam split, plays clean.  ",
    purchasePrice: { amount: 149.5, currency: "DKK" },
    purchaseDate: "2019-03-12",
  });

  expect(set).toMatchObject({
    note: "From Dad's shelf.\nSmall seam split, plays clean.",
    purchasePrice: { amount: 149.5, currency: "DKK" },
    purchaseDate: "2019-03-12",
    mediaCondition: "Very Good Plus (VG+)",
  });
  expect(await copyPage(owner, id)).toEqual(set);
  expect(await listCopies(owner)).toEqual([set]);

  const cleared = await changed(owner, id, { note: null, purchasePrice: null, purchaseDate: null });

  expect(cleared).toMatchObject({ note: null, purchasePrice: null, purchaseDate: null, gain: null });
  expect(await copyPage(owner, id)).toEqual(cleared);
});

test("each detail changes on its own and leaves the others, the conditions and the Value alone, without asking Discogs", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const { id } = await saved(owner);
  await changed(owner, id, { note: "Signed", purchasePrice: { amount: 100, currency: "DKK" }, purchaseDate: "2020-01-02" });
  const asked = app.discogs.requests.length;

  await changed(owner, id, { purchaseDate: "2021-05-06" });
  await changed(owner, id, { note: "" });
  const copy = await changed(owner, id, { purchasePrice: { amount: 120, currency: "DKK" } });

  expect(copy).toMatchObject({
    note: null,
    purchasePrice: { amount: 120, currency: "DKK" },
    purchaseDate: "2021-05-06",
    mediaCondition: "Very Good Plus (VG+)",
    sleeveCondition: "Very Good Plus (VG+)",
    value: { value: 223.8, currency: "DKK" },
  });
  expect(app.discogs.requests).toHaveLength(asked);
});

test("Gain is the Value minus the Purchase price, and is negative when the Copy is worth less than was paid", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const { id } = await saved(owner);

  const up = await changed(owner, id, { purchasePrice: { amount: 150, currency: "DKK" } });
  const down = await changed(owner, id, { purchasePrice: { amount: 300, currency: "DKK" } });
  const even = await changed(owner, id, { purchasePrice: { amount: 223.8, currency: "DKK" } });

  expect(up).toMatchObject({ value: { value: 223.8, currency: "DKK" }, gain: 73.8 });
  expect(down.gain).toBe(-76.2);
  expect(even.gain).toBe(0);
  expect(await listCopies(owner)).toMatchObject([{ gain: 0 }]);
});

test("there is no Gain without both a Value and a Purchase price", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const valued = await saved(owner, discovery);
  const unvalued = await saved(owner, gas5);

  const dateOnly = await changed(owner, valued.id, { purchaseDate: "2019-03-12", note: "No receipt" });
  const priceOnly = await changed(owner, unvalued.id, { purchasePrice: { amount: 80, currency: "DKK" } });

  expect(dateOnly).toMatchObject({ value: { value: 223.8 }, purchasePrice: null, gain: null });
  expect(priceOnly).toMatchObject({ value: { value: null }, purchasePrice: { amount: 80, currency: "DKK" }, gain: null });
});

test("a Purchase price keeps the currency it was paid in, and Gain converts it to each Member's own Currency", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const { id } = await saved(owner);

  const copy = await changed(owner, id, { purchasePrice: { amount: 20, currency: "EUR" } });

  expect(copy).toMatchObject({ purchasePrice: { amount: 20, currency: "EUR" }, value: { value: 223.8, currency: "DKK" }, gain: 74.6 });

  await app.request("/api/me/currency", {
    method: "PUT",
    headers: { cookie: owner.session, "content-type": "application/json" },
    body: JSON.stringify({ currency: "USD" }),
  });
  await owner.as("/values", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

  expect(await copyPage(owner, id)).toMatchObject({ purchasePrice: { amount: 20, currency: "EUR" }, value: { value: 33, currency: "USD" }, gain: 11 });
});

test("details that don't make sense are refused and change nothing", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const { id } = await saved(owner);
  const before = await changed(owner, id, { note: "Kept", purchasePrice: { amount: 100, currency: "DKK" }, purchaseDate: "2020-01-02" });

  const refused = [
    {},
    { note: 42 },
    { note: "x".repeat(2001) },
    { purchasePrice: 100 },
    { purchasePrice: { amount: -1, currency: "DKK" } },
    { purchasePrice: { amount: 10.005, currency: "DKK" } },
    { purchasePrice: { amount: "100", currency: "DKK" } },
    { purchasePrice: { amount: 1e12, currency: "DKK" } },
    { purchasePrice: { amount: 100 } },
    { purchasePrice: { amount: 100, currency: "XYZ" } },
    { purchaseDate: "2019-02-30" },
    { purchaseDate: "12/03/2019" },
    { purchaseDate: "2026-03-03" },
    { purchaseDate: 20190312 },
    { note: "Changed", purchaseDate: "not a date" },
  ];
  const responses = await Promise.all(refused.map((details) => change(owner, id, details)));

  expect(responses.map((response) => response.status)).toEqual(refused.map(() => 400));
  expect(await copyPage(owner, id)).toEqual(before);
});

test("a purchase date may be today in any time zone, and a Purchase price may be zero for a gift", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const { id } = await saved(owner);

  const copy = await changed(owner, id, { purchaseDate: "2026-03-02", purchasePrice: { amount: 0, currency: "DKK" } });

  expect(copy).toMatchObject({ purchaseDate: "2026-03-02", purchasePrice: { amount: 0, currency: "DKK" }, gain: 223.8 });
});

test("deleting a Copy with details and Values removes it from the Collection and leaves the others", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const kept = await changed(owner, (await saved(owner)).id, { note: "Keep me" });
  const { id } = await saved(owner);
  await changed(owner, id, { note: "Sold", purchasePrice: { amount: 150, currency: "DKK" }, purchaseDate: "2019-03-12" });

  const deleted = await owner.as(`/copies/${id}`, { method: "DELETE" });

  expect(deleted.status).toBe(204);
  expect(await listCopies(owner)).toEqual([kept]);
  expect((await owner.as(`/copies/${id}`)).status).toBe(404);
  expect((await change(owner, id, { note: "Back?" })).status).toBe(404);
  expect((await owner.as(`/copies/${id}`, { method: "DELETE" })).status).toBe(404);
});

test("only Members change a Copy's details or delete it", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  const copy = await changed(owner, (await saved(owner)).id, { note: "Mine" });
  const intoOwners = (path: string, init: RequestInit = {}) =>
    app.request(`/api/collections/${owner.collectionId}${path}`, { ...init, headers: { cookie: friend.session, ...init.headers } });
  const details = { note: "Theirs", purchasePrice: { amount: 1, currency: "DKK" }, purchaseDate: "2020-01-01" };

  const responses = [
    await intoOwners(`/copies/${copy.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(details) }),
    await change(friend, copy.id, details),
    await intoOwners(`/copies/${copy.id}`, { method: "DELETE" }),
    await friend.as(`/copies/${copy.id}`, { method: "DELETE" }),
    await app.request(`/api/collections/${owner.collectionId}/copies/${copy.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(details),
    }),
    await app.request(`/api/collections/${owner.collectionId}/copies/${copy.id}`, { method: "DELETE" }),
  ];

  expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 401, 401]);
  expect(await listCopies(owner)).toEqual([copy]);
});
