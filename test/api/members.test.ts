import { expect, test } from "vitest";
import { priceLadder, sampleReleases } from "../../src/server/fake-discogs.ts";
import { invitedFriend, logInWithCollection, saveCopy, type Member, type TestApp } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

const kindOfBlue = 2474032;
type MeAnswer = { collection: { id: string }; collections: { id: string; ownerDiscogsUsername: string; own: boolean }[] };

const json = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function me(app: TestApp, user: Member) {
  return (await (await app.request("/api/me", { headers: { cookie: user.session } })).json()) as MeAnswer;
}

/** The friend, working in the Owner's Collection. */
function inOwners(app: TestApp, friend: Member, owner: Member) {
  return (path: string, init: RequestInit = {}) =>
    app.request(`/api/collections/${owner.collectionId}${path}`, { ...init, headers: { cookie: friend.session, ...init.headers } });
}

async function ownerAndFriend() {
  const app = await createTestApp({ discogs: { releases: sampleReleases, prices: { [kindOfBlue]: priceLadder(30) } } });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  return { app, owner, friend };
}

test("the Owner adds a User as a Member, who then lists both Collections and works in the Owner's", async () => {
  const { app, owner, friend } = await ownerAndFriend();

  const added = await owner.as("/members", json("POST", { discogsUsername: "Friend" }));

  expect(added.status).toBe(201);
  expect(await added.json()).toMatchObject({ member: { discogsUsername: "friend", owner: false } });
  expect((await me(app, friend)).collections).toEqual([
    { id: friend.collectionId, ownerDiscogsUsername: "friend", own: true },
    { id: owner.collectionId, ownerDiscogsUsername: "app-owner", own: false },
  ]);
  const members = (await (await inOwners(app, friend, owner)("/members")).json()) as { members: { discogsUsername: string; owner: boolean }[] };
  expect(members.members.map(({ discogsUsername, owner: isOwner }) => [discogsUsername, isOwner])).toEqual([
    ["app-owner", true],
    ["friend", false],
  ]);

  const as = inOwners(app, friend, owner);
  const saved = await as("/copies", json("POST", { discogsReleaseId: kindOfBlue }));
  expect(saved.status).toBe(201);
  const { copy } = (await saved.json()) as { copy: { id: string } };
  expect((await as(`/copies/${copy.id}`, json("PATCH", { note: "Lent by friend" }))).status).toBe(200);

  expect(app.discogs.collectionOf("app-owner")).toMatchObject([{ discogsReleaseId: kindOfBlue, note: "Lent by friend" }]);
  expect(app.discogs.collectionOf("friend")).toEqual([]);
  expect((await as(`/copies/${copy.id}`, { method: "DELETE" })).status).toBe(204);
  expect(app.discogs.collectionOf("app-owner")).toEqual([]);
});

test("only the Owner adds or removes Members", async () => {
  const { app, owner, friend } = await ownerAndFriend();
  const third = await invitedFriend(app, owner.session, "third");
  await owner.as("/members", json("POST", { discogsUsername: "friend" }));
  const as = inOwners(app, friend, owner);

  expect((await as("/members", json("POST", { discogsUsername: "third" }))).status).toBe(403);
  const ownerId = ((await (await owner.as("/members")).json()) as { members: { userId: string; owner: boolean }[] }).members.find((member) => member.owner)!.userId;
  expect((await as(`/members/${ownerId}`, { method: "DELETE" })).status).toBe(403);
  expect((await owner.as(`/members/${ownerId}`, { method: "DELETE" })).status).toBe(400);
  expect((await me(app, third)).collections).toHaveLength(1);
});

test("adding someone who isn't a User yet says to send them an Invite", async () => {
  const { owner } = await ownerAndFriend();

  const response = await owner.as("/members", json("POST", { discogsUsername: "stranger" }));

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "No User has the Discogs username stranger. Send them an Invite first; once they have logged in you can add them." });
});

test("a removed Member loses the Collection, and the Copies they added stay in it", async () => {
  const { app, owner, friend } = await ownerAndFriend();
  const added = (await (await owner.as("/members", json("POST", { discogsUsername: "friend" }))).json()) as { member: { userId: string } };
  await inOwners(app, friend, owner)("/copies", json("POST", { discogsReleaseId: kindOfBlue }));

  expect((await owner.as(`/members/${added.member.userId}`, { method: "DELETE" })).status).toBe(204);

  expect((await inOwners(app, friend, owner)("/copies")).status).toBe(404);
  expect((await me(app, friend)).collections.map((collection) => collection.id)).toEqual([friend.collectionId]);
  expect(((await (await owner.as("/copies")).json()) as { total: number }).total).toBe(1);
});

test("a User who isn't a Member gets nothing from any endpoint of another Collection", async () => {
  const { app, owner, friend } = await ownerAndFriend();
  const { copy } = (await (await saveCopy(owner, kindOfBlue)).json()) as { copy: { id: string } };
  const routes = app.routes().filter((route) => route.path.startsWith("/api/collections/:collectionId/") && route.method !== "ALL");
  expect(routes.length).toBeGreaterThan(15);

  for (const { method, path } of routes) {
    const url = path
      .replace(":collectionId", owner.collectionId)
      .replace(":copyId", copy.id)
      .replace(/:[a-zA-Z]+/g, "00000000-0000-4000-8000-000000000000");
    const response = await app.request(url, { method, headers: { cookie: friend.session, "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });

    expect([`${method} ${path}`, response.status]).toEqual([`${method} ${path}`, 404]);
    expect(await response.json()).toEqual({ error: "No such Collection" });
  }
  expect(((await (await owner.as("/copies")).json()) as { total: number }).total).toBe(1);
});
