import { expect, test } from "vitest";
import type { FakeDiscogsScript } from "../../src/server/fake-discogs.ts";
import { createTestApp } from "../support/test-app.ts";

const fromPhone = (address: string, cookie?: string) => ({ "cf-connecting-ip": address, ...(cookie ? { cookie } : {}) });
const minutes = (count: number) => count * 60 * 1000;

async function startLogins(app: Awaited<ReturnType<typeof createTestApp>>, count: number, headers: Record<string, string>, path = "/api/login") {
  const locations: (string | null)[] = [];
  for (let i = 0; i < count; i++) locations.push((await app.request(path, { headers })).headers.get("location"));
  return locations;
}

test("someone who is not logged in can start 10 logins per 15 minutes from one device", async () => {
  const app = await createTestApp();

  const allowed = await startLogins(app, 10, fromPhone("203.0.113.1"));
  const [limited] = await startLogins(app, 1, fromPhone("203.0.113.1"));
  const [otherPhone] = await startLogins(app, 1, fromPhone("203.0.113.2"));
  app.clock.advance(minutes(15));
  const [later] = await startLogins(app, 1, fromPhone("203.0.113.1"));

  expect(allowed.every((location) => location?.startsWith("/fake-discogs/"))).toBe(true);
  expect(limited).toBe("/?login=too-many");
  expect(otherPhone).toMatch(/^\/fake-discogs\//);
  expect(later).toMatch(/^\/fake-discogs\//);
});

test("an invitee who hits the limit goes back to their Invite page with an explanation", async () => {
  const app = await createTestApp();
  const owner = (await app.logIn(app.appOwnerDiscogsUsername, { headers: fromPhone("198.51.100.9") })).session!;
  const created = await app.request("/api/invites", { method: "POST", headers: { cookie: owner } });
  const code = ((await created.json()) as { url: string }).url.split("/invite/")[1]!;

  await startLogins(app, 10, fromPhone("203.0.113.1"), `/api/login?invite=${code}`);
  const [limited] = await startLogins(app, 1, fromPhone("203.0.113.1"), `/api/login?invite=${code}`);

  expect(limited).toBe(`/invite/${code}?login=too-many`);
});

test("a logged-in User is not limited", async () => {
  const app = await createTestApp();
  const owner = (await app.logIn(app.appOwnerDiscogsUsername, { headers: fromPhone("203.0.113.1") })).session!;
  await startLogins(app, 9, fromPhone("203.0.113.1"));

  const [anonymous] = await startLogins(app, 1, fromPhone("203.0.113.1"));
  const [loggedIn] = await startLogins(app, 1, fromPhone("203.0.113.1", owner));

  expect(anonymous).toBe("/?login=too-many");
  expect(loggedIn).toMatch(/^\/fake-discogs\//);
});

test("when Discogs cannot start a login, the person sees an explanation instead of an error page", async () => {
  const script: FakeDiscogsScript = {};
  const app = await createTestApp({ discogs: script });
  const owner = (await app.logIn(app.appOwnerDiscogsUsername)).session!;
  const created = await app.request("/api/invites", { method: "POST", headers: { cookie: owner } });
  const code = ((await created.json()) as { url: string }).url.split("/invite/")[1]!;
  script.loginStartFails = true;

  const returning = await app.request("/api/login");
  const invitee = await app.request(`/api/login?invite=${code}`);

  expect(returning.status).toBe(302);
  expect(returning.headers.get("location")).toBe("/?login=discogs-unavailable");
  expect(invitee.status).toBe(302);
  expect(invitee.headers.get("location")).toBe(`/invite/${code}?login=discogs-unavailable`);
});
