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

test("a logged-in User has their own, larger limit", async () => {
  const app = await createTestApp();
  const owner = (await app.logIn(app.appOwnerDiscogsUsername, { headers: fromPhone("203.0.113.1") })).session!;
  await startLogins(app, 9, fromPhone("203.0.113.1"));

  const [anonymous] = await startLogins(app, 1, fromPhone("203.0.113.1"));
  const loggedIn = await startLogins(app, 30, fromPhone("203.0.113.1", owner));
  const [loggedInLimited] = await startLogins(app, 1, fromPhone("203.0.113.1", owner));

  expect(anonymous).toBe("/?login=too-many");
  expect(loggedIn.every((location) => location?.startsWith("/fake-discogs/"))).toBe(true);
  expect(loggedInLimited).toBe("/?login=too-many");
});

test("addresses in one IPv6 /64 count as one device", async () => {
  const app = await createTestApp();
  const sameNetwork = Array.from({ length: 10 }, (_, i) => `2001:db8:1:2::${(i + 1).toString(16)}`);

  for (const address of sameNetwork) await startLogins(app, 1, fromPhone(address));
  const [limited] = await startLogins(app, 1, fromPhone("2001:0db8:0001:0002:ffff:0:0:1"));
  const [otherNetwork] = await startLogins(app, 1, fromPhone("2001:db8:1:3::1"));

  expect(limited).toBe("/?login=too-many");
  expect(otherNetwork).toMatch(/^\/fake-discogs\//);
});

test("logged-out logins from many addresses cannot make more than 30 Discogs calls per 15 minutes", async () => {
  const app = await createTestApp();

  const locations: (string | null)[] = [];
  for (let i = 0; i < 40; i++) {
    const [location] = await startLogins(app, 1, fromPhone(`203.0.113.${i}`));
    locations.push(location ?? null);
    const requestToken = location?.startsWith("/fake-discogs/") ? new URL(location, "http://fake").searchParams.get("oauth_token") : null;
    if (requestToken) await app.request(`/api/login/callback?oauth_token=${requestToken}&oauth_verifier=junk`, { headers: fromPhone(`198.51.100.${i}`) });
  }
  app.clock.advance(minutes(15));
  const [later] = await startLogins(app, 1, fromPhone("192.0.2.1"));

  expect(app.discogs.calls.startLogin + app.discogs.calls.finishLogin).toBeLessThanOrEqual(31);
  expect(locations.at(-1)).toBe("/?login=too-many");
  expect(later).toMatch(/^\/fake-discogs\//);
});

test("callbacks without the login cookie cannot make unlimited Discogs calls for one login", async () => {
  const app = await createTestApp();
  const [authorizeUrl] = await startLogins(app, 1, fromPhone("203.0.113.1"));
  const requestToken = new URL(authorizeUrl!, "http://fake").searchParams.get("oauth_token")!;

  for (let i = 0; i < 200; i++) {
    await app.request(`/api/login/callback?oauth_token=${requestToken}&oauth_verifier=junk-${i}`, { headers: fromPhone(`198.51.100.${i % 250}`) });
  }

  expect(app.discogs.calls.finishLogin).toBeGreaterThan(0);
  expect(app.discogs.calls.finishLogin).toBeLessThanOrEqual(3);
});

test("callbacks for a login that has used up its Discogs checks leave the logged-out budget to other people", async () => {
  const app = await createTestApp();
  const [authorizeUrl] = await startLogins(app, 1, fromPhone("203.0.113.1"));
  const requestToken = new URL(authorizeUrl!, "http://fake").searchParams.get("oauth_token")!;
  for (let i = 0; i < 50; i++) {
    await app.request(`/api/login/callback?oauth_token=${requestToken}&oauth_verifier=junk-${i}`, { headers: fromPhone(`198.51.100.${i}`) });
  }

  const others: (string | null)[] = [];
  for (let i = 0; i < 20; i++) others.push(...(await startLogins(app, 1, fromPhone(`192.0.2.${i}`))));

  expect(others.every((location) => location?.startsWith("/fake-discogs/"))).toBe(true);
});

test("callbacks without the login cookie from one device share that device's limit", async () => {
  const app = await createTestApp();
  const requestTokens: string[] = [];
  for (let i = 0; i < 5; i++) {
    const [authorizeUrl] = await startLogins(app, 1, fromPhone(`203.0.113.${i}`));
    requestTokens.push(new URL(authorizeUrl!, "http://fake").searchParams.get("oauth_token")!);
  }

  for (const requestToken of requestTokens) {
    for (let i = 0; i < 3; i++) await app.request(`/api/login/callback?oauth_token=${requestToken}&oauth_verifier=junk-${i}`, { headers: fromPhone("198.51.100.1") });
  }

  expect(app.discogs.calls.finishLogin).toBe(10);
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
