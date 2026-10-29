import { expect, test } from "vitest";
import { cookieFrom, createTestApp } from "../support/test-app.ts";

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function inviteCode(app: TestApp) {
  const owner = (await app.logIn(app.appOwnerDiscogsUsername)).session!;
  const response = await app.request("/api/invites", { method: "POST", headers: { cookie: owner } });
  return ((await response.json()) as { url: string }).url.split("/invite/")[1]!;
}

test("the Invite code stays out of the addresses Discogs sees", async () => {
  const app = await createTestApp();
  const code = await inviteCode(app);

  const login = await app.startLogin({ invite: code });
  const callbackUrl = app.discogs.authorizeAs(login.authorizeUrl!, "friend");

  expect(login.authorizeUrl).not.toContain(code);
  expect(callbackUrl).not.toContain(code);
  expect(callbackUrl).not.toContain("invite");
  expect((await login.finish("friend")).headers.get("location")).toBe("/");
});

test("a refused invitee still goes back to their Invite page", async () => {
  const app = await createTestApp();
  const code = await inviteCode(app);
  const late = await app.startLogin({ invite: code });
  await app.logIn("friend", { invite: code });

  const callback = await late.finish("stranger");

  expect(callback.headers.get("location")).toBe(`/invite/${code}`);
});

test("when the login cookie never reaches the callback, an invitee returns to their Invite page with an explanation", async () => {
  const app = await createTestApp();
  const code = await inviteCode(app);
  const login = await app.startLogin({ invite: code });
  const callbackUrl = app.discogs.authorizeAs(login.authorizeUrl!, "friend");

  const withoutCookie = await app.request(callbackUrl);

  expect(withoutCookie.headers.get("location")).toBe(`/invite/${code}?login=cookie-missing`);
  expect(cookieFrom(withoutCookie, "lp_session")).toBeUndefined();
  const retryInTheRightBrowser = await login.finish("friend");
  expect(cookieFrom(retryInTheRightBrowser, "lp_session")).toBeDefined();
});

test("when the login cookie never reaches the callback, a returning User sees an explanation on the home page", async () => {
  const app = await createTestApp();
  const login = await app.startLogin();

  const withoutCookie = await app.request(app.discogs.authorizeAs(login.authorizeUrl!, app.appOwnerDiscogsUsername));

  expect(withoutCookie.headers.get("location")).toBe("/?login=cookie-missing");
  expect(cookieFrom(withoutCookie, "lp_session")).toBeUndefined();
});

test("a login started in a second tab does not break the login in the first tab", async () => {
  const app = await createTestApp();
  let jar = "";
  const browse = async (path: string) => {
    const response = await app.request(path, { headers: { cookie: jar } });
    const login = cookieFrom(response, "lp_login");
    if (login !== undefined) jar = login;
    return response;
  };

  const firstTab = (await browse("/api/login")).headers.get("location")!;
  const secondTab = (await browse("/api/login")).headers.get("location")!;
  const firstDone = await browse(app.discogs.authorizeAs(firstTab, app.appOwnerDiscogsUsername));
  const secondDone = await browse(app.discogs.authorizeAs(secondTab, app.appOwnerDiscogsUsername));

  expect(firstDone.headers.get("location")).toBe("/");
  expect(cookieFrom(firstDone, "lp_session")).toBeDefined();
  expect(secondDone.headers.get("location")).toBe("/");
  expect(cookieFrom(secondDone, "lp_session")).toBeDefined();
});
