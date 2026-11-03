import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, expect, test } from "vitest";
import { createRealDiscogs } from "../src/server/real-discogs.ts";

type Received = { method: string; path: string; headers: IncomingHttpHeaders; at: number; body: string };

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
      formats: [{ name: "Vinyl", text: "180 Gram" }, { name: "Vinyl", text: "Reissue" }, { name: "Vinyl" }],
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
  genres: ["Jazz"],
  styles: ["Modal", "Hard Bop"],
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

const lostMasterRelease = {
  id: 9100001,
  title: "Odds & Ends",
  artists: [{ name: "Someone" }],
  year: 1987,
  master_id: 404404,
};

async function startDiscogsStub({ tooManyRequestsFirst = 0 } = {}) {
  const received: Received[] = [];
  let throttled = 0;
  const server = createServer(async (request, response) => {
    const path = request.url ?? "";
    const at = performance.now();
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ method: request.method ?? "", path, headers: request.headers, at, body });
    const json = (body: unknown) => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(body));
    };
    if (!path.startsWith("/oauth/") && throttled < tooManyRequestsFirst) {
      throttled++;
      response.statusCode = 429;
      return json({ message: "You are making requests too quickly." });
    }
    if (path === "/database/search?barcode=886979891211&type=release&per_page=25") {
      json(kindOfBlueSearch);
    } else if (path === "/releases/2335811") {
      json(kindOfBlueRelease);
    } else if (path === "/masters/5460") {
      json({ id: 5460, title: "Kind Of Blue", year: 1959 });
    } else if (path === "/releases/1503928") {
      json(noMasterRelease);
    } else if (path === "/releases/9100001") {
      json(lostMasterRelease);
    } else if (path === "/marketplace/price_suggestions/2335811") {
      json({
        "Mint (M)": { currency: "EUR", value: 40.123 },
        "Very Good Plus (VG+)": { currency: "EUR", value: 24 },
        "Poor (P)": { currency: "EUR", value: 0 },
      });
    } else if (path === "/marketplace/price_suggestions/7371225") {
      json({});
    } else if (path === "/marketplace/price_suggestions/1503928") {
      response.statusCode = 400;
      json({ message: "You must fill out your seller settings first." });
    } else if (path === "/marketplace/price_suggestions/2474032") {
      response.statusCode = 404;
      json({ message: "You must fill out your seller settings first." });
    } else if (path === "/marketplace/price_suggestions/9100001") {
      response.statusCode = 500;
      json({ message: "Something went wrong." });
    } else if (path === "/marketplace/stats/2335811?curr_abbr=EUR") {
      json({ lowest_price: { currency: "EUR", value: 19.5 }, num_for_sale: 4, blocked_from_sale: false });
    } else if (path === "/marketplace/stats/1503928?curr_abbr=SEK") {
      json({ lowest_price: null, num_for_sale: null, blocked_from_sale: false });
    } else if (request.method === "POST" && path === "/users/vinyl-fan/collection/folders/1/releases/2335811") {
      response.statusCode = 201;
      json({ instance_id: 77, resource_url: "https://api.discogs.com/users/vinyl-fan/collection/folders/1/releases/2335811/instances/77" });
    } else if (path === "/users/vinyl-fan/collection/fields") {
      json({
        fields: [
          { id: 4, name: "Media Condition", type: "dropdown", position: 1, public: true },
          { id: 5, name: "Sleeve Condition", type: "dropdown", position: 2, public: true },
          { id: 7, name: "Notes", type: "textarea", position: 3, public: true },
        ],
      });
    } else if (request.method === "POST" && /^\/users\/vinyl-fan\/collection\/folders\/1\/releases\/2335811\/instances\/77\/fields\/[457]$/.test(path)) {
      response.statusCode = 204;
      response.end();
    } else if (request.method === "DELETE" && path === "/users/vinyl-fan/collection/folders/1/releases/2335811/instances/77") {
      response.statusCode = 204;
      response.end();
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

function gateway(url: string, options: { requestGapMs?: number; backoffMs?: number[]; maxWaitMs?: number } = {}) {
  return createRealDiscogs({ consumerKey: "consumer-key", consumerSecret: "consumer-secret", apiBaseUrl: url, requestGapMs: 0, ...options });
}

test("a barcode Lookup searches the Discogs database as the User and reads each candidate", async () => {
  const stub = await startDiscogsStub();

  const { candidates, total } = await gateway(stub.url).lookup({ barcode: "886979891211" }, auth);

  expect(total).toBe(2);
  expect(candidates).toEqual([
    {
      discogsReleaseId: 2335811,
      artist: "Miles Davis",
      title: "Kind Of Blue",
      label: "Columbia",
      catalogNumber: "CS 8163",
      country: "US",
      pressingYear: 2010,
      formats: ["Vinyl", "LP", "Album", "Reissue", "180 Gram"],
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
      formats: [],
      coverImageUrl: null,
    },
  ]);
  expect(oauthParams(stub.received[0]!.headers)).toMatchObject({ oauth_token: "user-token", oauth_signature: "consumer-secret&user-secret" });
});

test("an artist and title Lookup searches vinyl Releases by artist and release title, leaving out a blank one", async () => {
  const stub = await startDiscogsStub();
  const discogs = gateway(stub.url);

  const found = await discogs.lookup({ artist: "Miles Davis", title: "Kind of Blue" }, auth);
  await discogs.lookup({ artist: "", title: "Kind of Blue" }, auth);

  expect(found).toEqual({ candidates: [], total: 0 });
  expect(stub.received.map((request) => request.path)).toEqual([
    "/database/search?artist=Miles+Davis&release_title=Kind+of+Blue&format=Vinyl&type=release&per_page=25",
    "/database/search?release_title=Kind+of+Blue&format=Vinyl&type=release&per_page=25",
  ]);
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
    genres: ["Jazz"],
    styles: ["Modal", "Hard Bop"],
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
    genres: [],
    styles: [],
  });
  expect(stub.received).toHaveLength(1);
});

test("a Release Discogs doesn't have reads as no Release", async () => {
  const stub = await startDiscogsStub();

  await expect(gateway(stub.url).release(1, auth)).resolves.toBeUndefined();
});

test("a Release whose master release Discogs can't find takes its own year as the Original year", async () => {
  const stub = await startDiscogsStub();

  const release = await gateway(stub.url).release(9100001, auth);

  expect(release).toMatchObject({ pressingYear: 1987, originalYear: 1987 });
  expect(stub.received.map((request) => request.path)).toEqual(["/releases/9100001", "/masters/404404"]);
});

test("every request to Discogs waits its turn in one queue, whoever's token it carries, because Discogs limits by source IP", async () => {
  const stub = await startDiscogsStub();
  const discogs = gateway(stub.url, { requestGapMs: 300 });

  await Promise.all([
    discogs.release(2335811, auth),
    discogs.lookup({ barcode: "886979891211" }, { token: "other", secret: "s" }),
    discogs.startLogin("https://lp.example/api/login/callback"),
  ]);

  expect(stub.received).toHaveLength(4);
  const gaps = stub.received.slice(1).map((request, index) => request.at - stub.received[index]!.at);
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(200);
});

test("a request that would wait longer than the cap fails at once instead of queueing", async () => {
  const stub = await startDiscogsStub();
  const discogs = gateway(stub.url, { requestGapMs: 5_000, maxWaitMs: 1_000 });

  const started = performance.now();
  const [first, second] = await Promise.allSettled([
    discogs.lookup({ barcode: "886979891211" }, auth),
    discogs.lookup({ barcode: "886979891211" }, auth),
  ]);

  expect(first.status).toBe("fulfilled");
  expect(second.status).toBe("rejected");
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(stub.received).toHaveLength(1);
});

test("after Discogs answers 429 Too Many Requests the gateway backs off and tries again", async () => {
  const stub = await startDiscogsStub({ tooManyRequestsFirst: 2 });

  const { candidates } = await gateway(stub.url, { backoffMs: [10, 10, 10] }).lookup({ barcode: "886979891211" }, auth);

  expect(candidates).toHaveLength(2);
  expect(stub.received).toHaveLength(3);
});

test("the gateway gives up when Discogs keeps answering 429", async () => {
  const stub = await startDiscogsStub({ tooManyRequestsFirst: 10 });

  await expect(gateway(stub.url, { backoffMs: [10] }).lookup({ barcode: "886979891211" }, auth)).rejects.toThrow(/HTTP 429/);
  expect(stub.received).toHaveLength(2);
});

test("the gateway stops backing off once the next retry would pass the cap", async () => {
  const stub = await startDiscogsStub({ tooManyRequestsFirst: 10 });

  const started = performance.now();
  await expect(gateway(stub.url, { backoffMs: [100, 5_000], maxWaitMs: 1_000 }).lookup({ barcode: "886979891211" }, auth)).rejects.toThrow(/HTTP 429/);

  expect(performance.now() - started).toBeLessThan(1_000);
  expect(stub.received).toHaveLength(2);
});

test("the real gateway reads price suggestions per Media condition and spots missing seller settings", async () => {
  const stub = await startDiscogsStub();
  const discogs = createRealDiscogs({ consumerKey: "k", consumerSecret: "s", apiBaseUrl: stub.url, webBaseUrl: "https://discogs.example", requestGapMs: 0 });
  const auth = { token: "access-token", secret: "access-secret" };

  expect(await discogs.priceSuggestions(2335811, auth)).toEqual({
    kind: "suggested",
    prices: { "Mint (M)": { amount: 40.12, currency: "EUR" }, "Very Good Plus (VG+)": { amount: 24, currency: "EUR" } },
  });
  expect(await discogs.priceSuggestions(7371225, auth)).toEqual({ kind: "suggested", prices: {} });
  expect(await discogs.priceSuggestions(404404, auth)).toEqual({ kind: "suggested", prices: {} });
  expect(await discogs.priceSuggestions(2474032, auth)).toEqual({ kind: "seller-settings-missing" });
  expect(await discogs.priceSuggestions(1503928, auth)).toEqual({ kind: "seller-settings-missing" });
  await expect(discogs.priceSuggestions(9100001, auth)).rejects.toThrow("HTTP 500");
  expect(discogs.sellerSettingsUrl).toBe("https://discogs.example/settings/seller");
  expect(oauthParams(stub.received[0]!.headers)).toMatchObject({ oauth_token: "access-token" });
});

test("the real gateway asks for the Lowest listing in the given currency, which can be missing", async () => {
  const stub = await startDiscogsStub();
  const discogs = createRealDiscogs({ consumerKey: "k", consumerSecret: "s", apiBaseUrl: stub.url, requestGapMs: 0 });
  const auth = { token: "access-token", secret: "access-secret" };

  expect(await discogs.lowestListing(2335811, "EUR", auth)).toEqual({ amount: 19.5, currency: "EUR" });
  expect(await discogs.lowestListing(1503928, "SEK", auth)).toBeNull();
  expect(await discogs.lowestListing(404404, "EUR", auth)).toBeNull();
});

test("the real gateway adds a Release to the user's collection in Uncategorized and reads the new instance id", async () => {
  const stub = await startDiscogsStub();

  const item = await gateway(stub.url).addToCollection("vinyl-fan", 2335811, auth);

  expect(item).toEqual({ discogsReleaseId: 2335811, folderId: 1, instanceId: 77 });
  expect(stub.received.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /users/vinyl-fan/collection/folders/1/releases/2335811"]);
  expect(oauthParams(stub.received[0]!.headers).oauth_token).toBe(auth.token);
});

test("the real gateway sets both conditions and the note on a collection item, finding each field by its name", async () => {
  const stub = await startDiscogsStub();
  const discogs = gateway(stub.url);
  const item = { discogsReleaseId: 2335811, folderId: 1, instanceId: 77 };

  await discogs.setCollectionFields("vinyl-fan", item, { mediaCondition: "Near Mint (NM or M-)", sleeveCondition: "Generic", note: "Signed" }, auth);
  await discogs.setCollectionFields("vinyl-fan", item, { mediaCondition: "Good (G)", sleeveCondition: "No Cover", note: null }, auth);

  const instance = "/users/vinyl-fan/collection/folders/1/releases/2335811/instances/77";
  expect(stub.received.map(({ method, path, body }) => `${method} ${path} ${body}`)).toEqual([
    "GET /users/vinyl-fan/collection/fields ",
    `POST ${instance}/fields/4 {"value":"Near Mint (NM or M-)"}`,
    `POST ${instance}/fields/5 {"value":"Generic"}`,
    `POST ${instance}/fields/7 {"value":"Signed"}`,
    `POST ${instance}/fields/4 {"value":"Good (G)"}`,
    `POST ${instance}/fields/5 {"value":"No Cover"}`,
    `POST ${instance}/fields/7 {"value":""}`,
  ]);
  expect(stub.received[1]!.headers["content-type"]).toBe("application/json");
});

test("the real gateway removes a collection item, and an item Discogs no longer has counts as removed", async () => {
  const stub = await startDiscogsStub();
  const discogs = gateway(stub.url);

  await discogs.removeFromCollection("vinyl-fan", { discogsReleaseId: 2335811, folderId: 1, instanceId: 77 }, auth);
  await discogs.removeFromCollection("vinyl-fan", { discogsReleaseId: 2335811, folderId: 1, instanceId: 78 }, auth);

  expect(stub.received.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "DELETE /users/vinyl-fan/collection/folders/1/releases/2335811/instances/77",
    "DELETE /users/vinyl-fan/collection/folders/1/releases/2335811/instances/78",
  ]);
});

test("a collection change Discogs refuses throws, so the mirror tries it again later", async () => {
  const stub = await startDiscogsStub();

  await expect(gateway(stub.url).addToCollection("vinyl-fan", 1503928, auth)).rejects.toThrow(/HTTP 404/);
});
