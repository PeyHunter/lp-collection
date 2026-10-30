import { expect, test } from "vitest";
import { createTestApp } from "../support/test-app.ts";

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function me(app: TestApp, session: string | undefined) {
  const response = await app.request("/api/me", { headers: session ? { cookie: session } : {} });
  return response.status === 200 ? ((await response.json()) as { discogsUsername: string; canCreateInvites: boolean; collection: { id: string } }) : undefined;
}

async function inviteCode(app: TestApp, session: string) {
  const response = await app.request("/api/invites", { method: "POST", headers: { cookie: session } });
  return ((await response.json()) as { url: string }).url.split("/invite/")[1]!;
}

test("whoever takes over the app Owner's old Discogs username gets no Owner rights", async () => {
  const app = await createTestApp({ appOwnerDiscogsUsername: "Peyton" });
  const owner = await app.logIn("peyton");
  const code = await inviteCode(app, owner.session!);
  app.discogs.renameAccount("peyton", "peyton-renamed");

  const newcomerWithoutInvite = await app.logIn("peyton");
  const newcomer = await app.logIn("peyton", { invite: code });
  const createdByNewcomer = await app.request("/api/invites", { method: "POST", headers: { cookie: newcomer.session! } });

  expect(newcomerWithoutInvite).toMatchObject({ session: undefined, location: "/" });
  expect(await me(app, newcomer.session)).toMatchObject({ discogsUsername: "peyton", canCreateInvites: false });
  expect(createdByNewcomer.status).toBe(403);
});

test("the app's Owner keeps Owner rights after renaming their Discogs account", async () => {
  const app = await createTestApp({ appOwnerDiscogsUsername: "peyton" });
  const before = await app.logIn("peyton");
  app.discogs.renameAccount("peyton", "peyton-renamed");

  const after = await app.logIn("peyton-renamed");

  expect(await me(app, after.session)).toEqual({
    discogsUsername: "peyton-renamed",
    canCreateInvites: true,
    collection: (await me(app, before.session))!.collection,
  });
  expect(await me(app, before.session)).toMatchObject({ canCreateInvites: true });
});

test("naming a different person as the app's Owner hands Owner rights to them at their next login", async () => {
  const app = await createTestApp({ appOwnerDiscogsUsername: "peyton" });
  const peyton = await app.logIn("peyton");
  const code = await inviteCode(app, peyton.session!);
  const friend = await app.logIn("friend", { invite: code });

  app.restart({ appOwnerDiscogsUsername: "friend" });
  const friendAgain = await app.logIn("friend");

  expect(await me(app, friendAgain.session)).toMatchObject({ discogsUsername: "friend", canCreateInvites: true });
  expect(await me(app, friend.session)).toMatchObject({ canCreateInvites: true });
  expect(await me(app, peyton.session)).toMatchObject({ canCreateInvites: false });
});
