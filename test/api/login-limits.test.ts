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

  const allowed: (string | null)[] = [];
  for (let i = 0; i < 10; i++) {
    allowed.push(...(await startLogins(app, 1, fromPhone("203.0.113.1"))));
    app.clock.advance(minutes(1));
  }
  const [limited] = await startLogins(app, 1, fromPhone("203.0.113.1"));
  const [otherPhone] = await startLogins(app, 1, fromPhone("203.0.113.2"));
  app.clock.advance(minutes(5));
  const [later] = await startLogins(app, 1, fromPhone("203.0.113.1"));

  expect(allowed.every((location) => location?.startsWith("/fake-discogs/"))).toBe(true);
  expect(limited).toBe("/?login=too-many");
  expect(otherPhone).toMatch(/^\/fake-discogs\//);
  expect(later).toMatch(/^\/fake-discogs\//);
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
  app.clock.advance(minutes(1));
  const [otherNetwork] = await startLogins(app, 1, fromPhone("2001:db8:1:3::1"));

  expect(limited).toBe("/?login=too-many");
  expect(otherNetwork).toMatch(/^\/fake-discogs\//);
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
  for (let i = 0; i < 6; i++) others.push(...(await startLogins(app, 1, fromPhone(`192.0.2.${i}`))));

  expect(others.every((location) => location?.startsWith("/fake-discogs/"))).toBe(true);
});

test("callbacks without the login cookie from one device share that device's limit", async () => {
  const app = await createTestApp();
  const requestTokens: string[] = [];
  for (let i = 0; i < 5; i++) {
    const [authorizeUrl] = await startLogins(app, 1, fromPhone(`203.0.113.${i}`));
    requestTokens.push(new URL(authorizeUrl!, "http://fake").searchParams.get("oauth_token")!);
  }
  app.clock.advance(minutes(1));

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

async function createInvite(app: Awaited<ReturnType<typeof createTestApp>>) {
  const owner = (await app.logIn(app.appOwnerDiscogsUsername, { headers: fromPhone("198.51.100.9") })).session!;
  const created = await app.request("/api/invites", { method: "POST", headers: { cookie: owner } });
  return ((await created.json()) as { url: string }).url.split("/invite/")[1]!;
}

test("strangers who use up the logged-out budget cannot stop an invited friend from logging in", async () => {
  const app = await createTestApp();
  const code = await createInvite(app);

  const strangers: (string | null)[] = [];
  for (let i = 0; i < 60; i++) strangers.push(...(await startLogins(app, 1, fromPhone(`2001:db8:${i.toString(16)}::1`))));
  const friend = await app.logIn("friend", { invite: code, headers: fromPhone("192.0.2.77") });

  expect(friend.location).toBe("/");
  expect(friend.session).toBeDefined();
  expect(strangers.at(-1)).toBe("/?login=busy");
});

test("logins started with an unknown Invite reach no Discogs and spend no budget", async () => {
  const app = await createTestApp();

  const junk = await startLogins(app, 50, fromPhone("203.0.113.1"), "/api/login?invite=junk");
  const [real] = await startLogins(app, 1, fromPhone("203.0.113.1"));

  expect(junk.every((location) => location === "/invite/junk")).toBe(true);
  expect(real).toMatch(/^\/fake-discogs\//);
  expect(app.discogs.calls.startLogin).toBe(1);
});

test("logged-out logins from many addresses reach Discogs at most 10 times a minute, and the rest are told the app is busy", async () => {
  const app = await createTestApp();

  const perMinute: number[] = [];
  const lastEachMinute: (string | null)[] = [];
  for (let minute = 0; minute < 15; minute++) {
    const before = app.discogs.calls.startLogin + app.discogs.calls.finishLogin;
    let last: string | null = null;
    for (let i = 0; i < 30; i++) {
      last = (await startLogins(app, 1, fromPhone(`10.${minute}.0.${i}`)))[0] ?? null;
      const requestToken = last?.startsWith("/fake-discogs/") ? new URL(last, "http://fake").searchParams.get("oauth_token") : null;
      if (requestToken) await app.request(`/api/login/callback?oauth_token=${requestToken}&oauth_verifier=junk`, { headers: fromPhone(`10.${minute}.1.${i}`) });
    }
    perMinute.push(app.discogs.calls.startLogin + app.discogs.calls.finishLogin - before);
    lastEachMinute.push(last);
    app.clock.advance(minutes(1));
  }

  expect(Math.max(...perMinute)).toBe(10);
  expect(lastEachMinute.every((location) => location === "/?login=busy")).toBe(true);
});

test("one Invite can start 5 logins per 15 minutes", async () => {
  const app = await createTestApp();
  const code = await createInvite(app);

  const allowed: (string | null)[] = [];
  for (let i = 0; i < 5; i++) allowed.push(...(await startLogins(app, 1, fromPhone(`192.0.2.${i}`), `/api/login?invite=${code}`)));
  const [limited] = await startLogins(app, 1, fromPhone("192.0.2.99"), `/api/login?invite=${code}`);
  app.clock.advance(minutes(15));
  const [later] = await startLogins(app, 1, fromPhone("192.0.2.99"), `/api/login?invite=${code}`);

  expect(allowed.every((location) => location?.startsWith("/fake-discogs/"))).toBe(true);
  expect(limited).toBe(`/invite/${code}?login=too-many`);
  expect(later).toMatch(/^\/fake-discogs\//);
});

test("logged-out logins reach Discogs at most 10 times in any 60 seconds, even around the moment a minute ends", async () => {
  const app = await createTestApp();
  const seconds = (count: number) => count * 1000;
  const startedAt: number[] = [];
  let elapsed = 0;
  const burst = async (network: number, size: number) => {
    for (let i = 0; i < size; i++) {
      const [location] = await startLogins(app, 1, fromPhone(`10.${network}.0.${i}`));
      if (location?.startsWith("/fake-discogs/")) startedAt.push(elapsed);
    }
  };
  const wait = (ms: number) => {
    app.clock.advance(ms);
    elapsed += ms;
  };

  await burst(1, 1);
  wait(seconds(59));
  await burst(2, 20);
  wait(seconds(1));
  await burst(3, 20);

  const mostInOneMinute = Math.max(...startedAt.map((from) => startedAt.filter((at) => at >= from && at < from + seconds(60)).length));
  expect(startedAt.length).toBeGreaterThan(10);
  expect(mostInOneMinute).toBe(10);
});

test("a person told the app is busy keeps every login their device has left", async () => {
  const app = await createTestApp();
  for (let i = 0; i < 10; i++) await startLogins(app, 1, fromPhone(`192.0.2.${i}`));

  const whileBusy = await startLogins(app, 15, fromPhone("203.0.113.1"));
  app.clock.advance(minutes(1));
  const afterwards = await startLogins(app, 10, fromPhone("203.0.113.1"));

  expect(whileBusy.every((location) => location === "/?login=busy")).toBe(true);
  expect(afterwards.every((location) => location?.startsWith("/fake-discogs/"))).toBe(true);
});

test("an invitee whose browser keeps losing its login cookie spends only their login starts", async () => {
  const app = await createTestApp();
  const code = await createInvite(app);

  const lostCookie: (string | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const login = await app.startLogin({ invite: code, headers: fromPhone("192.0.2.77") });
    lostCookie.push((await app.request(app.discogs.authorizeAs(login.authorizeUrl!, "friend"), { headers: fromPhone("192.0.2.77") })).headers.get("location"));
  }
  const keptCookie = await app.logIn("friend", { invite: code, headers: fromPhone("192.0.2.77") });

  expect(lostCookie.every((location) => location === `/invite/${code}?login=cookie-missing`)).toBe(true);
  expect(keptCookie.location).toBe("/");
});

test("callbacks for an Invite's login that Discogs refuses still spend that Invite's budget", async () => {
  const app = await createTestApp();
  const code = await createInvite(app);
  const [authorizeUrl] = await startLogins(app, 1, fromPhone("192.0.2.1"), `/api/login?invite=${code}`);
  const requestToken = new URL(authorizeUrl!, "http://fake").searchParams.get("oauth_token")!;
  for (let i = 0; i < 3; i++) await app.request(`/api/login/callback?oauth_token=${requestToken}&oauth_verifier=junk-${i}`, { headers: fromPhone("198.51.100.1") });

  const [allowed] = await startLogins(app, 1, fromPhone("192.0.2.1"), `/api/login?invite=${code}`);
  const [limited] = await startLogins(app, 1, fromPhone("192.0.2.1"), `/api/login?invite=${code}`);

  expect(allowed).toMatch(/^\/fake-discogs\//);
  expect(limited).toBe(`/invite/${code}?login=too-many`);
});

test("concurrent callbacks without the login cookie cannot make an Invite reach Discogs more than its budget allows", async () => {
  const app = await createTestApp({ discogs: { finishLoginDelayMs: 100 } });
  const code = await createInvite(app);
  const before = app.discogs.calls.startLogin + app.discogs.calls.finishLogin;

  const requestTokens: string[] = [];
  for (let i = 0; i < 4; i++) {
    const [authorizeUrl] = await startLogins(app, 1, fromPhone(`192.0.2.${i}`), `/api/login?invite=${code}`);
    requestTokens.push(new URL(authorizeUrl!, "http://fake").searchParams.get("oauth_token")!);
  }
  await Promise.all(
    requestTokens.flatMap((requestToken) =>
      [0, 1, 2].map((i) => app.request(`/api/login/callback?oauth_token=${requestToken}&oauth_verifier=junk-${i}`, { headers: fromPhone(`203.0.113.${i}`) })),
    ),
  );
  const [afterwards] = await startLogins(app, 1, fromPhone("192.0.2.50"), `/api/login?invite=${code}`);

  expect(app.discogs.calls.startLogin + app.discogs.calls.finishLogin - before).toBe(5);
  expect(afterwards).toBe(`/invite/${code}?login=too-many`);
});
