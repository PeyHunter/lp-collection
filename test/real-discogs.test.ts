import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, expect, test } from "vitest";
import { createRealDiscogs } from "../src/server/real-discogs.ts";

type Received = { method: string; path: string; headers: IncomingHttpHeaders; at: number };

const kindOfBlueSearch = {
  pagination: { page: 1, pages: 1, per_page: 50, items: 2 },
  results: [
    {
      id: 2335811,
      type: "release",
      master_id: 5460,
      title: "Miles Davis - Kind Of Blue",
      country: "US",
      year: "2010",
      label: ["Columbia", "Legacy (2)"],
      catno: "CS 8163",
      format: ["Vinyl", "LP", "Album", "Reissue"],
      barcode: ["8 86979 89121 1"],
      cover_image: "https://i.discogs.com/kind-of-blue.jpeg",
    },
    {
      id: 7371225,
      type: "release",
      title: "Nirvana (2) - Untitled - Live",
      country: "",
      label: [],
      catno: "none",
      format: [],
      cover_image: "https://st.discogs.com/images/spacer.gif",
    },
  ],
};

const kindOfBlueRelease = {
  id: 2335811,
  title: "Kind Of Blue",
  artists: [{ name: "Miles Davis", join: "" }],
  labels: [{ name: "Columbia", catno: "CS 8163" }],
  country: "US",
  year: 2010,
  master_id: 5460,
  images: [
    { type: "secondary", uri: "https://i.discogs.com/back.jpeg" },
    { type: "primary", uri: "https://i.discogs.com/front.jpeg" },
  ],
};

const noMasterRelease = {
  id: 1503928,
  title: "Bookends",
  artists: [
    { name: "Simon (3)", join: "&" },
    { name: "Garfunkel", join: "," },
    { name: "Orchestra (12)", join: "" },
  ],
  labels: [{ name: "CBS (2)", catno: "none" }],
  country: "Denmark",
  year: 0,
};

async function startDiscogsStub({ tooManyRequestsFirst = 0 } = {}) {
  const received: Received[] = [];
  let throttled = 0;
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    received.push({ method: request.method ?? "", path, headers: request.headers, at: performance.now() });
    const json = (body: unknown) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(body));
    };
    if (!path.startsWith("/oauth/") && throttled < tooManyRequestsFirst) {
      throttled++;
      response.statusCode = 429;
      return json({ message: "You are making requests too quickly." });
    }
    if (path === "/database/search?barcode=886979891211&type=release&per_page=50") {
      json(kindOfBlueSearch);
    } else if (path === "/releases/2335811") {
      json(kindOfBlueRelease);
    } else if (path === "/masters/5460") {
      json({ id: 5460, title: "Kind Of Blue", year: 1959 });
    } else if (path === "/releases/1503928") {
      json(noMasterRelease);
    } else if (path === "/oauth/request_token") {
      response.end("oauth_token=request-token&oauth_token_secret=request-secret&oauth_callback_confirmed=true");
    } else if (path === "/oauth/access_token") {
      response.end("oauth_token=access-token&oauth_token_secret=access-secret");
    } else if (path === "/oauth/identity") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ id: 4242, username: "vinyl-fan", resource_url: "https://api.discogs.com/users/vinyl-fan" }));
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

function oauthParams(headers: IncomingHttpHeaders) {
  const header = headers.authorization ?? "";
  expect(header.startsWith("OAuth ")).toBe(true);
  return Object.fromEntries(
    [...header.slice("OAuth ".length).matchAll(/(\w+)="([^"]*)"/g)].map(([, name, value]) => [name, decodeURIComponent(value!)]),
  );
}

test("the real gateway logs a person in with Discogs' OAuth 1.0a PLAINTEXT handshake", async () => {
  const stub = await startDiscogsStub();
  const discogs = createRealDiscogs({
    consumerKey: "consumer-key",
    consumerSecret: "consumer-secret",
    apiBaseUrl: stub.url,
    webBaseUrl: "https://discogs.example",
  });

  const start = await discogs.startLogin("https://lp.example/api/login/callback");
  const identity = await discogs.finishLogin({
    requestToken: start.requestToken,
    requestSecret: start.requestSecret,
    verifier: "the-verifier",
  });

  expect(start.authorizeUrl).toBe("https://discogs.example/oauth/authorize?oauth_token=request-token");
  expect(identity).toEqual({
    discogsUserId: 4242,
    discogsUsername: "vinyl-fan",
    accessToken: "access-token",
    accessSecret: "access-secret",
  });

  const [requestToken, accessToken, whoAmI] = stub.received;
  expect([requestToken?.method, requestToken?.path]).toEqual(["GET", "/oauth/request_token"]);
  expect(oauthParams(requestToken!.headers)).toMatchObject({
    oauth_consumer_key: "consumer-key",
    oauth_signature: "consumer-secret&",
    oauth_signature_method: "PLAINTEXT",
    oauth_callback: "https://lp.example/api/login/callback",
  });
  expect([accessToken?.method, accessToken?.path]).toEqual(["POST", "/oauth/access_token"]);
  expect(oauthParams(accessToken!.headers)).toMatchObject({
    oauth_consumer_key: "consumer-key",
    oauth_token: "request-token",
    oauth_verifier: "the-verifier",
    oauth_signature: "consumer-secret&request-secret",
    oauth_signature_method: "PLAINTEXT",
  });
  expect([whoAmI?.method, whoAmI?.path]).toEqual(["GET", "/oauth/identity"]);
  expect(oauthParams(whoAmI!.headers)).toMatchObject({
    oauth_token: "access-token",
    oauth_signature: "consumer-secret&access-secret",
  });
  for (const request of stub.received) {
    const params = oauthParams(request.headers);
    expect(params.oauth_nonce).toMatch(/\S/);
    expect(params.oauth_timestamp).toMatch(/^\d+$/);
    expect(request.headers["user-agent"]).toMatch(/^LP-Collection\//);
    expect(request.headers["content-type"]).toBe("application/x-www-form-urlencoded");
  }
});

test("the PLAINTEXT signature percent-encodes each secret before joining them with &", async () => {
  const stub = await startDiscogsStub();
  const discogs = createRealDiscogs({ consumerKey: "consumer-key", consumerSecret: "a&b=c d!*'()%", apiBaseUrl: stub.url });

  await discogs.startLogin("https://lp.example/api/login/callback");

  expect(oauthParams(stub.received[0]!.headers).oauth_signature).toBe("a%26b%3Dc%20d%21%2A%27%28%29%25&");
});

const auth = { token: "user-token", secret: "user-secret" };

function gateway(url: string, options: { requestGapMs?: number; backoffMs?: number[] } = {}) {
  return createRealDiscogs({ consumerKey: "consumer-key", consumerSecret: "consumer-secret", apiBaseUrl: url, requestGapMs: 0, ...options });
}

test("a barcode Lookup searches the Discogs database as the User and reads each candidate", async () => {
  const stub = await startDiscogsStub();

  const candidates = await gateway(stub.url).lookupByBarcode("886979891211", auth);

  expect(candidates).toEqual([
    {
      discogsReleaseId: 2335811,
      artist: "Miles Davis",
      title: "Kind Of Blue",
      label: "Columbia",
      catalogNumber: "CS 8163",
      country: "US",
      pressingYear: 2010,
      format: "Vinyl, LP, Album, Reissue",
      coverImageUrl: "https://i.discogs.com/kind-of-blue.jpeg",
    },
    {
      discogsReleaseId: 7371225,
      artist: "Nirvana",
      title: "Untitled - Live",
      label: null,
      catalogNumber: null,
      country: null,
      pressingYear: null,
      format: null,
      coverImageUrl: null,
    },
  ]);
  expect(oauthParams(stub.received[0]!.headers)).toMatchObject({ oauth_token: "user-token", oauth_signature: "consumer-secret&user-secret" });
});

test("Release details take the Original year from the master release", async () => {
  const stub = await startDiscogsStub();

  const release = await gateway(stub.url).release(2335811, auth);

  expect(release).toEqual({
    discogsReleaseId: 2335811,
    artist: "Miles Davis",
    title: "Kind Of Blue",
    label: "Columbia",
    catalogNumber: "CS 8163",
    country: "US",
    pressingYear: 2010,
    originalYear: 1959,
    coverImageUrl: "https://i.discogs.com/front.jpeg",
  });
  expect(stub.received.map((request) => request.path)).toEqual(["/releases/2335811", "/masters/5460"]);
});

test("a Release with no master release and no year has no Original year, and its artists read as Discogs credits them", async () => {
  const stub = await startDiscogsStub();

  const release = await gateway(stub.url).release(1503928, auth);

  expect(release).toMatchObject({
    artist: "Simon & Garfunkel, Orchestra",
    label: "CBS",
    catalogNumber: null,
    pressingYear: null,
    originalYear: null,
    coverImageUrl: null,
  });
  expect(stub.received).toHaveLength(1);
});

test("requests with one User's token are spaced out to stay under Discogs' rate limit", async () => {
  const stub = await startDiscogsStub();
  const discogs = gateway(stub.url, { requestGapMs: 300 });

  await Promise.all([discogs.release(2335811, auth), discogs.lookupByBarcode("886979891211", auth)]);

  expect(stub.received).toHaveLength(3);
  const gaps = stub.received.slice(1).map((request, index) => request.at - stub.received[index]!.at);
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(200);
});

test("another User's token does not wait behind the first User's requests", async () => {
  const stub = await startDiscogsStub();
  const discogs = gateway(stub.url, { requestGapMs: 5_000 });

  const started = performance.now();
  await Promise.all([discogs.lookupByBarcode("886979891211", auth), discogs.lookupByBarcode("886979891211", { token: "other", secret: "s" })]);

  expect(performance.now() - started).toBeLessThan(2_000);
});

test("after Discogs answers 429 Too Many Requests the gateway backs off and tries again", async () => {
  const stub = await startDiscogsStub({ tooManyRequestsFirst: 2 });

  const candidates = await gateway(stub.url, { backoffMs: [10, 10, 10] }).lookupByBarcode("886979891211", auth);

  expect(candidates).toHaveLength(2);
  expect(stub.received).toHaveLength(3);
});

test("the gateway gives up when Discogs keeps answering 429", async () => {
  const stub = await startDiscogsStub({ tooManyRequestsFirst: 10 });

  await expect(gateway(stub.url, { backoffMs: [10] }).lookupByBarcode("886979891211", auth)).rejects.toThrow(/HTTP 429/);
  expect(stub.received).toHaveLength(2);
});
