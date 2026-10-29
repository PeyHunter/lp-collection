import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, expect, test } from "vitest";
import { createRealDiscogs } from "../src/server/real-discogs.ts";

type Received = { method: string; path: string; headers: IncomingHttpHeaders };

/** Plays Discogs' three OAuth endpoints and records what the app sent. */
async function startDiscogsStub() {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    received.push({ method: request.method ?? "", path, headers: request.headers });
    if (path === "/oauth/request_token") {
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
