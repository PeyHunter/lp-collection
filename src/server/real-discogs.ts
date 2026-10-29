import { randomBytes } from "node:crypto";
import type { DiscogsGateway } from "./discogs.ts";

export type RealDiscogsOptions = {
  consumerKey: string;
  consumerSecret: string;
  apiBaseUrl?: string;
  webBaseUrl?: string;
};

const userAgent = "LP-Collection/1.0 +https://github.com/PeyHunter/lp-collection";

/**
 * Talks to the live Discogs API with OAuth 1.0a, PLAINTEXT signatures over HTTPS,
 * as https://www.discogs.com/developers (Authentication) describes.
 */
export function createRealDiscogs({
  consumerKey,
  consumerSecret,
  apiBaseUrl = "https://api.discogs.com",
  webBaseUrl = "https://www.discogs.com",
}: RealDiscogsOptions): DiscogsGateway {
  async function call(method: "GET" | "POST", path: string, tokenSecret: string, params: Record<string, string>) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: authorizationHeader({
          oauth_consumer_key: consumerKey,
          oauth_nonce: randomBytes(16).toString("hex"),
          oauth_signature: `${consumerSecret}&${tokenSecret}`,
          oauth_signature_method: "PLAINTEXT",
          oauth_timestamp: String(Math.floor(Date.now() / 1000)),
          ...params,
        }),
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
    });
    if (!response.ok) throw new Error(`Discogs answered ${method} ${path} with HTTP ${response.status}: ${await response.text()}`);
    return response;
  }

  async function tokenPair(response: Response) {
    const body = new URLSearchParams(await response.text());
    const token = body.get("oauth_token");
    const secret = body.get("oauth_token_secret");
    if (!token || !secret) throw new Error("Discogs sent no OAuth token");
    return { token, secret };
  }

  return {
    async lookupByBarcode() {
      throw new Error("Lookup on the real Discogs gateway is not built yet");
    },
    async startLogin(callbackUrl) {
      const { token, secret } = await tokenPair(await call("GET", "/oauth/request_token", "", { oauth_callback: callbackUrl }));
      return {
        requestToken: token,
        requestSecret: secret,
        authorizeUrl: `${webBaseUrl}/oauth/authorize?oauth_token=${encodeURIComponent(token)}`,
      };
    },
    async finishLogin({ requestToken, requestSecret, verifier }) {
      const access = await tokenPair(
        await call("POST", "/oauth/access_token", requestSecret, { oauth_token: requestToken, oauth_verifier: verifier }),
      );
      const identity = (await (await call("GET", "/oauth/identity", access.secret, { oauth_token: access.token })).json()) as {
        id?: unknown;
        username?: unknown;
      };
      if (typeof identity.id !== "number" || typeof identity.username !== "string") {
        throw new Error("Discogs identity had no id or username");
      }
      return {
        discogsUserId: identity.id,
        discogsUsername: identity.username,
        accessToken: access.token,
        accessSecret: access.secret,
      };
    },
  };
}

function authorizationHeader(params: Record<string, string>) {
  return `OAuth ${Object.entries(params)
    .map(([name, value]) => `${name}="${encodeURIComponent(value)}"`)
    .join(", ")}`;
}
