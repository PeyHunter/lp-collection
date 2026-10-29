import { expect, test } from "vitest";
import { cookieFrom, createTestApp, days } from "../support/test-app.ts";

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function logInAsAppOwner(app: TestApp) {
  const { session } = await app.logIn(app.appOwnerDiscogsUsername);
  expect(session).toBeDefined();
  return session!;
}

async function createInvite(app: TestApp, session: string) {
  const response = await app.request("/api/invites", { method: "POST", headers: { cookie: session } });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { url: string; expiresAt: string };
  const code = body.url.split("/invite/")[1]!;
  return { ...body, code };
}

async function me(app: TestApp, session: string | undefined) {
  const response = await app.request("/api/me", { headers: session ? { cookie: session } : {} });
  return { status: response.status, body: response.status === 200 ? await response.json() : undefined };
}

test("a valid Invite lets a new person log in with Discogs and gives them their own empty Collection", async () => {
  const app = await createTestApp();
  const owner = await logInAsAppOwner(app);
  const invite = await createInvite(app, owner);

  expect(invite.url).toMatch(/^http:\/\/localhost\/invite\/[A-Za-z0-9_-]{43}$/);
  expect(invite.expiresAt).toBe("2026-03-08T12:00:00.000Z");
  const opened = await app.request(`/api/invites/${invite.code}`);
  expect(opened.status).toBe(200);
  expect(await opened.json()).toEqual({ status: "valid", expiresAt: "2026-03-08T12:00:00.000Z" });

  const login = await app.logIn("friend", { invite: invite.code });

  expect(login.location).toBe("/");
  const friend = await me(app, login.session);
  const ownerMe = await me(app, owner);
  expect(friend).toEqual({
    status: 200,
    body: { discogsUsername: "friend", canCreateInvites: false, collection: { id: expect.any(String) } },
  });
  expect(friend.body.collection.id).not.toBe(ownerMe.body.collection.id);
});

test("an Invite expires 7 days after it was created", async () => {
  const app = await createTestApp();
  const invite = await createInvite(app, await logInAsAppOwner(app));

  app.clock.advance(days(7) - 1);
  expect((await app.request(`/api/invites/${invite.code}`)).status).toBe(200);
  app.clock.advance(1);
  const opened = await app.request(`/api/invites/${invite.code}`);
  const login = await app.logIn("friend", { invite: invite.code });

  expect(opened.status).toBe(410);
  expect(await opened.json()).toEqual({ status: "expired" });
  expect(login).toMatchObject({ session: undefined, location: `/invite/${invite.code}` });
  expect((await me(app, login.session)).status).toBe(401);
});

test("an Invite works only once", async () => {
  const app = await createTestApp();
  const invite = await createInvite(app, await logInAsAppOwner(app));
  const first = await app.logIn("friend", { invite: invite.code });

  const second = await app.logIn("stranger", { invite: invite.code });
  const opened = await app.request(`/api/invites/${invite.code}`);

  expect(first.session).toBeDefined();
  expect(second).toMatchObject({ session: undefined, location: `/invite/${invite.code}` });
  expect(opened.status).toBe(410);
  expect(await opened.json()).toEqual({ status: "used" });
});

test("an Invite used up while the second person was on Discogs still refuses them", async () => {
  const app = await createTestApp();
  const invite = await createInvite(app, await logInAsAppOwner(app));
  const strangerLogin = await app.startLogin({ invite: invite.code });
  await app.logIn("friend", { invite: invite.code });

  const strangerCallback = await strangerLogin.finish("stranger");

  expect(strangerCallback.status).toBe(302);
  expect(strangerCallback.headers.get("location")).toBe(`/invite/${invite.code}`);
  expect(cookieFrom(strangerCallback, "lp_session")).toBeUndefined();
});

test("two people finishing their login with the same Invite at the same moment: only one gets in", async () => {
  const app = await createTestApp();
  const invite = await createInvite(app, await logInAsAppOwner(app));
  const people = ["friend", "stranger", "neighbour", "cousin"];
  const logins = await Promise.all(people.map(() => app.startLogin({ invite: invite.code })));

  const callbacks = await Promise.all(people.map((name, index) => logins[index]!.finish(name)));

  expect(callbacks.filter((callback) => cookieFrom(callback, "lp_session") !== undefined)).toHaveLength(1);
});

test("without an Invite a new person gets no account", async () => {
  const app = await createTestApp();

  const login = await app.logIn("stranger");
  const unknownInvite = await app.request("/api/invites/not-a-real-code");
  const loginWithUnknownInvite = await app.logIn("stranger", { invite: "not-a-real-code" });

  expect(login).toMatchObject({ session: undefined, location: "/" });
  expect((await me(app, undefined)).status).toBe(401);
  expect(unknownInvite.status).toBe(404);
  expect(await unknownInvite.json()).toEqual({ status: "unknown" });
  expect(loginWithUnknownInvite).toMatchObject({ session: undefined, location: "/invite/not-a-real-code" });
});

test("only the app's Owner can create Invites", async () => {
  const app = await createTestApp({ appOwnerDiscogsUsername: "Peyton" });
  const owner = await app.logIn("peyton");
  const invite = await createInvite(app, owner.session!);
  const friend = await app.logIn("friend", { invite: invite.code });

  const asFriend = await app.request("/api/invites", { method: "POST", headers: { cookie: friend.session! } });
  const asNobody = await app.request("/api/invites", { method: "POST" });

  expect((await me(app, owner.session)).body).toMatchObject({ discogsUsername: "peyton", canCreateInvites: true });
  expect(asFriend.status).toBe(403);
  expect(asNobody.status).toBe(401);
});

test("a returning User logs in again without an Invite and finds the same Collection", async () => {
  const app = await createTestApp();
  const invite = await createInvite(app, await logInAsAppOwner(app));
  const firstVisit = await app.logIn("friend", { invite: invite.code });
  app.clock.advance(days(30));

  const secondVisit = await app.logIn("friend");

  expect(secondVisit.location).toBe("/");
  expect(secondVisit.session).not.toBe(firstVisit.session);
  expect((await me(app, secondVisit.session)).body).toEqual((await me(app, firstVisit.session)).body);
});

test("logging out ends the session", async () => {
  const app = await createTestApp();
  const session = await logInAsAppOwner(app);

  const logout = await app.request("/api/logout", { method: "POST", headers: { cookie: session } });

  expect(logout.status).toBe(204);
  expect(logout.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  expect((await me(app, session)).status).toBe(401);
});

test("a session keeps a User logged in for 400 days", async () => {
  const app = await createTestApp();
  const { session, setCookie } = await app.logIn(app.appOwnerDiscogsUsername);

  expect(setCookie).toMatch(/Max-Age=34560000/);
  expect(setCookie).toMatch(/HttpOnly/);
  expect(setCookie).toMatch(/SameSite=Lax/);
  expect(setCookie).toMatch(/Path=\//);
  expect(setCookie).not.toMatch(/Secure/);
  app.clock.advance(days(399));
  expect((await me(app, session)).status).toBe(200);
  app.clock.advance(days(1));
  expect((await me(app, session)).status).toBe(401);
});

test("a login left unfinished for more than 15 minutes is refused", async () => {
  const app = await createTestApp();
  const login = await app.startLogin();
  app.clock.advance(15 * 60 * 1000 + 1);

  const callback = await login.finish(app.appOwnerDiscogsUsername);

  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe("/");
  expect(cookieFrom(callback, "lp_session")).toBeUndefined();
});
