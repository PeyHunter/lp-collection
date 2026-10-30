import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { DiscogsGateway, DiscogsIdentity, ReleaseCandidate } from "./discogs.ts";

/** What the fake Discogs answers in a test, e.g. which Releases a barcode matches. */
export type FakeDiscogsScript = {
  releasesByBarcode?: Record<string, ReleaseCandidate[]>;
  loginStartFails?: boolean;
};

export type FakeDiscogs = DiscogsGateway & {
  authorizeAs(authorizeUrl: string, discogsUsername: string): string;
  /** The account named `from` takes the name `to`, and a different, new account takes the name `from`. */
  renameAccount(from: string, to: string): void;
  issuedIdentities: DiscogsIdentity[];
  calls: { startLogin: number; finishLogin: number };
  pages: Hono;
};

const authorizePath = "/fake-discogs/authorize";

export function createFakeDiscogs(script: FakeDiscogsScript = {}): FakeDiscogs {
  const pending = new Map<string, { requestSecret: string; callbackUrl: string; authorized?: { verifier: string; discogsUsername: string } }>();
  const issuedIdentities: DiscogsIdentity[] = [];
  const calls = { startLogin: 0, finishLogin: 0 };
  const renamedAccounts = new Map<string, number>();
  const discogsUserIdOf = (discogsUsername: string) =>
    renamedAccounts.get(discogsUsername.toLowerCase()) ?? fakeDiscogsUserId(discogsUsername);

  function callbackFor(requestToken: string, discogsUsername: string) {
    const login = pending.get(requestToken);
    if (!login) throw new Error(`Fake Discogs has no login waiting for request token ${requestToken}`);
    const verifier = randomUUID();
    login.authorized = { verifier, discogsUsername };
    const url = new URL(login.callbackUrl);
    url.searchParams.set("oauth_token", requestToken);
    url.searchParams.set("oauth_verifier", verifier);
    return url.href;
  }

  const pages = new Hono();
  pages.get(authorizePath, (c) => {
    const requestToken = c.req.query("oauth_token") ?? "";
    const login = pending.get(requestToken);
    if (!login) return c.html(page("<p>This login has expired. Go back to LP-Collection and try again.</p>"), 404);
    return c.html(
      page(`<form method="post" action="${authorizePath}">
      <input type="hidden" name="oauth_token" value="${escapeHtml(requestToken)}">
      <label for="username">Discogs username</label>
      <input id="username" name="username" required autocomplete="username" autocapitalize="none">
      <button type="submit">Authorize</button>
    </form>`),
    );
  });
  pages.post(authorizePath, async (c) => {
    const form = await c.req.parseBody();
    const requestToken = String(form.oauth_token ?? "");
    if (!pending.has(requestToken)) return c.html(page("<p>This login has expired. Go back to LP-Collection and try again.</p>"), 404);
    return c.redirect(callbackFor(requestToken, String(form.username ?? "")), 302);
  });

  return {
    async lookupByBarcode(barcode) {
      return script.releasesByBarcode?.[barcode] ?? [];
    },
    async startLogin(callbackUrl) {
      calls.startLogin += 1;
      if (script.loginStartFails) throw new Error("Fake Discogs is scripted to refuse new logins");
      const requestToken = randomUUID();
      const requestSecret = randomUUID();
      pending.set(requestToken, { requestSecret, callbackUrl });
      return { requestToken, requestSecret, authorizeUrl: `${authorizePath}?oauth_token=${requestToken}` };
    },
    async finishLogin({ requestToken, requestSecret, verifier }) {
      calls.finishLogin += 1;
      const login = pending.get(requestToken);
      if (!login || login.requestSecret !== requestSecret) throw new Error("Fake Discogs refused an unknown request token");
      if (!login.authorized || login.authorized.verifier !== verifier) throw new Error("Fake Discogs refused a wrong verifier");
      pending.delete(requestToken);
      const { discogsUsername } = login.authorized;
      const identity = {
        discogsUserId: discogsUserIdOf(discogsUsername),
        discogsUsername,
        accessToken: randomUUID(),
        accessSecret: randomUUID(),
      };
      issuedIdentities.push(identity);
      return identity;
    },
    renameAccount(from, to) {
      renamedAccounts.set(to.toLowerCase(), discogsUserIdOf(from));
      renamedAccounts.set(from.toLowerCase(), fakeDiscogsUserId(`${from} (a new account)`));
    },
    authorizeAs(authorizeUrl, discogsUsername) {
      const requestToken = new URL(authorizeUrl, "http://fake-discogs").searchParams.get("oauth_token") ?? "";
      return callbackFor(requestToken, discogsUsername);
    },
    issuedIdentities,
    calls,
    pages,
  };
}

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
