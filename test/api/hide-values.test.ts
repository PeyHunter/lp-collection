import { expect, test } from "vitest";
import { priceLadder, sampleReleases, type FakeDiscogsScript } from "../../src/server/fake-discogs.ts";
import { invitedFriend, logInWithCollection, saveCopy, type Member, type TestApp } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

const discovery = 16893476;
const gas5 = 1503928;

const priced: FakeDiscogsScript = {
  releases: sampleReleases,
  prices: { [discovery]: priceLadder(40), [gas5]: priceLadder(10) },
  lowestListings: { [discovery]: { amount: 31, currency: "EUR" } },
  sellerSettingsMissingFor: (discogsUsername) => discogsUsername === "no-seller-settings",
};

const valueFields = ["value", "gain", "purchasePrice", "purchaseDate"];

function showValues(app: TestApp, user: Member, show: unknown) {
  return app.request("/api/me/show-values", {
    method: "PUT",
    headers: { cookie: user.session, "content-type": "application/json" },
    body: JSON.stringify({ showValues: show }),
  });
}

async function me(app: TestApp, user: Member) {
  return (await (await app.request("/api/me", { headers: { cookie: user.session } })).json()) as Record<string, unknown>;
}

async function body(response: Response | Promise<Response>) {
  const answer = await response;
  return { status: answer.status, text: await answer.text() };
}

function json(method: string, details: object): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(details) };
}

async function ownerWithPricedCopy(app: TestApp) {
  const owner = await logInWithCollection(app);
  const created = (await (await saveCopy(owner, discovery)).json()) as { copy: { id: string } };
  await owner.as(`/copies/${created.copy.id}`, json("PATCH", { purchasePrice: { amount: 100, currency: "DKK" }, purchaseDate: "2020-01-02" }));
  return { owner, copyId: created.copy.id };
}

function priceRequests(app: TestApp) {
  return app.discogs.requests.filter((request) => request.endpoint === "price-suggestions" || request.endpoint === "stats");
}

test("a User shows Values until they switch them off, and the switch is remembered", async () => {
  const app = await createTestApp({ discogs: priced });
  const owner = await logInWithCollection(app);

  expect(await me(app, owner)).toMatchObject({ showValues: true });

  const off = await showValues(app, owner, false);
  expect(off.status).toBe(200);
  expect(await off.json()).toEqual({ showValues: false });
  expect(await me(app, owner)).toMatchObject({ showValues: false });

  expect((await showValues(app, owner, "no")).status).toBe(400);
  expect(await me(app, owner)).toMatchObject({ showValues: false });
  expect((await app.request("/api/me/show-values", json("PUT", { showValues: true }))).status).toBe(401);
});

test("with Values off, no Copy answer carries a Value, Lowest listing, Gain, Purchase price, purchase date or seller settings state", async () => {
  const app = await createTestApp({ discogs: priced });
  const { owner, copyId } = await ownerWithPricedCopy(app);
  await showValues(app, owner, false);

  const save = await body(saveCopy(owner, gas5));
  const answers = {
    save,
    list: await body(owner.as("/copies")),
    listByArtist: await body(owner.as("/copies?sort=artist")),
    copy: await body(owner.as(`/copies/${copyId}`)),
    patch: await body(owner.as(`/copies/${copyId}`, json("PATCH", { note: "Signed" }))),
  };

  for (const [name, answer] of Object.entries(answers)) {
    expect(answer.status, name).toBeLessThan(300);
    for (const field of [...valueFields, "lowestListing", "sellerSettingsMissing"]) expect(answer.text, `${name} carries ${field}`).not.toContain(`"${field}"`);
    expect(answer.text, `${name} carries the Value`).not.toMatch(/223[.,]8|"DKK"/);
  }
  const listed = JSON.parse(answers.list.text) as { copies: { id: string; note: string | null }[]; groups: { key: string }[] };
  expect(listed.copies.map((copy) => copy.id)).toHaveLength(2);
  expect(listed.groups.map((group) => group.key)).toEqual(["D", "G"]);
});

test("with Values off, sorting by Value is refused and no Value is fetched from Discogs", async () => {
  const app = await createTestApp({ discogs: priced });
  const { owner, copyId } = await ownerWithPricedCopy(app);
  await showValues(app, owner, false);
  app.discogs.requests.length = 0;

  const byValue = await owner.as("/copies?sort=value");
  expect(byValue.status).toBe(400);
  expect(await byValue.text()).not.toMatch(/value/i);

  await saveCopy(owner, gas5);
  await owner.as(`/copies/${copyId}`, json("PATCH", { mediaCondition: "Mint (M)" }));
  const values = await body(owner.as("/values", json("POST", { retryEmpty: true })));

  expect(values.status).toBe(200);
  expect(JSON.parse(values.text)).toEqual({ more: false });
  expect(priceRequests(app)).toEqual([]);
});

test("switching Values back on shows every Value, Gain and Purchase price again without asking Discogs", async () => {
  const app = await createTestApp({ discogs: priced });
  const { owner, copyId } = await ownerWithPricedCopy(app);
  const before = await body(owner.as(`/copies/${copyId}`));
  await showValues(app, owner, false);
  await owner.as("/copies");
  app.discogs.requests.length = 0;

  await showValues(app, owner, true);
  const after = await body(owner.as(`/copies/${copyId}`));
  const list = (await (await owner.as("/copies")).json()) as { copies: unknown[]; sellerSettingsMissing: boolean };

  expect(after).toEqual(before);
  expect(JSON.parse(after.text)).toMatchObject({ copy: { value: { value: 223.8 }, gain: 123.8, purchasePrice: { amount: 100 }, purchaseDate: "2020-01-02" } });
  expect(list).toMatchObject({ copies: [{ value: { value: 223.8 } }], sellerSettingsMissing: false });
  expect((await owner.as("/copies?sort=value")).status).toBe(200);
  expect(priceRequests(app)).toEqual([]);
});

test("Members of one Collection each have their own Values switch", async () => {
  const app = await createTestApp({ discogs: priced });
  const { owner, copyId } = await ownerWithPricedCopy(app);
  const invited = await invitedFriend(app, owner.session, "friend");
  const [friendId] = await app.query<{ user_id: string }>("SELECT user_id FROM memberships WHERE collection_id = $1", [invited.collectionId]);
  await app.query("INSERT INTO memberships (collection_id, user_id) VALUES ($1, $2)", [owner.collectionId, friendId!.user_id]);
  const friend: Member = {
    ...invited,
    collectionId: owner.collectionId,
    as: (path, init = {}) => app.request(`/api/collections/${owner.collectionId}${path}`, { ...init, headers: { cookie: invited.session, ...init.headers } }),
  };

  await showValues(app, friend, false);

  expect(await me(app, owner)).toMatchObject({ showValues: true });
  expect(await me(app, friend)).toMatchObject({ showValues: false });
  expect(await (await owner.as(`/copies/${copyId}`)).json()).toMatchObject({ copy: { value: { value: 223.8 }, gain: 123.8 } });
  expect(await (await friend.as(`/copies/${copyId}`)).text()).not.toContain('"value"');
});
