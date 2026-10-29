import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { DiscogsGateway, ReleaseCandidate } from "./discogs.ts";

/** What the fake Discogs answers in a test, e.g. which Releases a barcode matches. */
export type FakeDiscogsScript = {
  releasesByBarcode?: Record<string, ReleaseCandidate[]>;
};

export type FakeDiscogs = DiscogsGateway & {
  /** Plays the person on the authorize page: returns the callback URL Discogs would send them back to. */
  authorizeAs(authorizeUrl: string, discogsUsername: string): string;
  /** The page a person sees in place of Discogs' authorize page when running locally. */
  pages: Hono;
};

const authorizePath = "/fake-discogs/authorize";

/**
 * Stands in for Discogs in tests and local development.
 * Its login protocol: the verifier is the Discogs username the person typed.
 */
export function createFakeDiscogs(script: FakeDiscogsScript = {}): FakeDiscogs {
  const pending = new Map<string, { requestSecret: string; callbackUrl: string }>();

  function callbackFor(requestToken: string, discogsUsername: string) {
    const login = pending.get(requestToken);
    if (!login) throw new Error(`Fake Discogs has no login waiting for request token ${requestToken}`);
    const url = new URL(login.callbackUrl);
    url.searchParams.set("oauth_token", requestToken);
    url.searchParams.set("oauth_verifier", discogsUsername);
    return url.href;
  }

  const pages = new Hono();
  pages.get(authorizePath, (c) => {
    const requestToken = c.req.query("oauth_token") ?? "";
    const login = pending.get(requestToken);
    if (!login) return c.html(page("<p>This login has expired. Go back to LP-Collection and try again.</p>"), 404);
    const callback = new URL(login.callbackUrl);
    const hidden = [...callback.searchParams, ["oauth_token", requestToken]]
      .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name!)}" value="${escapeHtml(value!)}">`)
      .join("\n      ");
    return c.html(
      page(`<form method="get" action="${escapeHtml(callback.origin + callback.pathname)}">
      ${hidden}
      <label for="username">Discogs username</label>
      <input id="username" name="oauth_verifier" required autocomplete="username" autocapitalize="none">
      <button type="submit">Authorize</button>
    </form>`),
    );
  });

  return {
    async lookupByBarcode(barcode) {
      return script.releasesByBarcode?.[barcode] ?? [];
    },
    async startLogin(callbackUrl) {
      const requestToken = randomUUID();
      const requestSecret = randomUUID();
      pending.set(requestToken, { requestSecret, callbackUrl });
      return { requestToken, requestSecret, authorizeUrl: `${authorizePath}?oauth_token=${requestToken}` };
    },
    async finishLogin({ requestToken, requestSecret, verifier }) {
      const login = pending.get(requestToken);
      if (!login || login.requestSecret !== requestSecret) throw new Error("Fake Discogs refused an unknown request token");
      pending.delete(requestToken);
      return {
        discogsUserId: fakeDiscogsUserId(verifier),
        discogsUsername: verifier,
        accessToken: randomUUID(),
        accessSecret: randomUUID(),
      };
    },
    authorizeAs(authorizeUrl, discogsUsername) {
      const requestToken = new URL(authorizeUrl, "http://fake-discogs").searchParams.get("oauth_token") ?? "";
      return callbackFor(requestToken, discogsUsername);
    },
    pages,
  };
}

// Derived from the username so the same person keeps the same Discogs identity across restarts.
function fakeDiscogsUserId(discogsUsername: string) {
  return createHash("sha256").update(discogsUsername.toLowerCase()).digest().readUInt32BE(0) & 0x7fffffff;
}

function page(body: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Fake Discogs</title>
  </head>
  <body>
    <h1>Fake Discogs</h1>
    ${body}
  </body>
</html>`;
}

function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
