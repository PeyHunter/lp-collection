import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { conditions, type Condition, type DiscogsAuth, type DiscogsCurrency, type DiscogsGateway, type DiscogsIdentity, type Money, type Release } from "./discogs.ts";
import { converter, sampleRatesPerEuro } from "./exchange-rates.ts";

export type FakeRelease = Release & { barcodes: string[]; format: string | null };

export type FakePrices = Partial<Record<Condition, Money>>;

/** What the fake Discogs answers in a test, e.g. which Releases a barcode matches. */
export type FakeDiscogsScript = {
  releases?: FakeRelease[];
  prices?: Record<number, FakePrices>;
  lowestListings?: Record<number, Money>;
  /** Discogs usernames whose seller settings are not filled in, so Discogs refuses to suggest prices. */
  sellerSettingsMissingFor?: string[];
  unavailable?: boolean;
  loginStartFails?: boolean;
  finishLoginDelayMs?: number;
};

export type FakeDiscogsRequest = (
  | { endpoint: "search"; barcode: string }
  | { endpoint: "release"; discogsReleaseId: number }
  | { endpoint: "price-suggestions"; discogsReleaseId: number }
  | { endpoint: "stats"; discogsReleaseId: number; currency: DiscogsCurrency }
) &
  DiscogsAuth;

export type FakeDiscogs = DiscogsGateway & {
  authorizeAs(authorizeUrl: string, discogsUsername: string): string;
  /** The account named `from` takes the name `to`, and a different, new account takes the name `from`. */
  renameAccount(from: string, to: string): void;
  fillInSellerSettings(discogsUsername: string): void;
  issuedIdentities: DiscogsIdentity[];
  calls: { startLogin: number; finishLogin: number };
  requests: FakeDiscogsRequest[];
  pages: Hono;
};

const authorizePath = "/fake-discogs/authorize";
const sellerSettingsPath = "/fake-discogs/settings/seller";
const convert = converter(sampleRatesPerEuro);

export function createFakeDiscogs(script: FakeDiscogsScript = {}): FakeDiscogs {
  const pending = new Map<string, { requestSecret: string; callbackUrl: string; authorized?: { verifier: string; discogsUsername: string } }>();
  const issuedIdentities: DiscogsIdentity[] = [];
  const calls = { startLogin: 0, finishLogin: 0 };
  const renamedAccounts = new Map<string, number>();
  const discogsUserIdOf = (discogsUsername: string) =>
    renamedAccounts.get(discogsUsername.toLowerCase()) ?? fakeDiscogsUserId(discogsUsername);
  const releases = script.releases ?? [];
  const requests: FakeDiscogsRequest[] = [];
  const sellerSettingsMissing = new Set((script.sellerSettingsMissingFor ?? []).map((name) => name.toLowerCase()));
  const usernameOf = (auth: DiscogsAuth) =>
    issuedIdentities.findLast((identity) => identity.accessToken === auth.token)?.discogsUsername.toLowerCase();

  function answer(request: FakeDiscogsRequest) {
    requests.push(request);
    if (script.unavailable) throw new Error("Fake Discogs is scripted to be unavailable");
  }

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

  pages.get(sellerSettingsPath, (c) =>
    c.html(
      page(`<h2>Seller settings</h2>
    <form method="post" action="${sellerSettingsPath}">
      <label for="username">Discogs username</label>
      <input id="username" name="username" required autocomplete="username" autocapitalize="none">
      <button type="submit">Save seller settings</button>
    </form>`),
    ),
  );
  pages.post(sellerSettingsPath, async (c) => {
    const form = await c.req.parseBody();
    sellerSettingsMissing.delete(String(form.username ?? "").toLowerCase());
    return c.html(page("<p>Your seller settings are saved. Go back to LP-Collection.</p>"));
  });

  pages.get(`${coverPath}/:file`, (c) => {
    const id = Number.parseInt(c.req.param("file"), 10);
    const release = releases.find((candidate) => candidate.discogsReleaseId === id);
    if (!release) return c.notFound();
    return c.body(coverSvg(release), 200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" });
  });

  return {
    sellerSettingsUrl: sellerSettingsPath,
    async priceSuggestions(discogsReleaseId, auth) {
      answer({ endpoint: "price-suggestions", discogsReleaseId, ...auth });
      if (sellerSettingsMissing.has(usernameOf(auth) ?? "")) return { kind: "seller-settings-missing" };
      return { kind: "suggested", prices: script.prices?.[discogsReleaseId] ?? {} };
    },
    async lowestListing(discogsReleaseId, currency, auth) {
      answer({ endpoint: "stats", discogsReleaseId, currency, ...auth });
      const lowest = script.lowestListings?.[discogsReleaseId];
      return lowest ? convert(lowest, currency) : null;
    },
    async lookupByBarcode(barcode, auth) {
      answer({ endpoint: "search", barcode, ...auth });
      return releases
        .filter((release) => release.barcodes.includes(barcode))
        .map(({ originalYear: _, barcodes: __, ...candidate }) => candidate);
    },
    async release(discogsReleaseId, auth) {
      answer({ endpoint: "release", discogsReleaseId, ...auth });
      const found = releases.find((release) => release.discogsReleaseId === discogsReleaseId);
      if (!found) return undefined;
      const { barcodes: _, format: __, ...release } = found;
      return release;
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
      if (script.finishLoginDelayMs) await new Promise((resolve) => setTimeout(resolve, script.finishLoginDelayMs));
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
    fillInSellerSettings(discogsUsername) {
      sellerSettingsMissing.delete(discogsUsername.toLowerCase());
    },
    authorizeAs(authorizeUrl, discogsUsername) {
      const requestToken = new URL(authorizeUrl, "http://fake-discogs").searchParams.get("oauth_token") ?? "";
      return callbackFor(requestToken, discogsUsername);
    },
    issuedIdentities,
    calls,
    requests,
    pages,
  };
}

const coverPath = "/fake-discogs/covers";

function fakeCoverUrl(discogsReleaseId: number) {
  return `${coverPath}/${discogsReleaseId}.svg`;
}

function coverSvg({ discogsReleaseId, title }: Release) {
  const hue = (discogsReleaseId * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><title>${escapeHtml(title)}</title><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="oklch(55% 0.12 ${hue})"/><stop offset="1" stop-color="oklch(25% 0.06 ${hue})"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="40" cy="44" r="18" fill="oklch(85% 0.1 ${(hue + 60) % 360})"/></svg>`;
}

export const sampleReleases: FakeRelease[] = [
  {
    discogsReleaseId: 2335811,
    artist: "Miles Davis",
    title: "Kind Of Blue",
    label: "Columbia",
    catalogNumber: "CS 8163",
    country: "US",
    pressingYear: 2010,
    originalYear: 1959,
    format: "Vinyl, LP, Album, Reissue, Stereo, 180g",
    coverImageUrl: fakeCoverUrl(2335811),
    barcodes: ["886979891211"],
  },
  {
    discogsReleaseId: 2474032,
    artist: "Miles Davis",
    title: "Kind Of Blue",
    label: "Columbia",
    catalogNumber: "88697 98912 1",
    country: "Europe",
    pressingYear: 2010,
    originalYear: 1959,
    format: "Vinyl, LP, Album, Reissue, Stereo",
    coverImageUrl: fakeCoverUrl(2474032),
    barcodes: ["886979891211"],
  },
  {
    discogsReleaseId: 7371225,
    artist: "Miles Davis",
    title: "Kind Of Blue",
    label: "Sony Music",
    catalogNumber: "88697 98912 1",
    country: "Europe",
    pressingYear: 2015,
    originalYear: 1959,
    format: "Vinyl, LP, Album, Reissue, Remastered",
    coverImageUrl: null,
    barcodes: ["886979891211"],
  },
  {
    discogsReleaseId: 16893476,
    artist: "Daft Punk",
    title: "Discovery",
    label: "Parlophone",
    catalogNumber: "0190295328709",
    country: "Europe",
    pressingYear: 2021,
    originalYear: 2001,
    format: "Vinyl, 2×LP, Album, Reissue",
    coverImageUrl: fakeCoverUrl(16893476),
    barcodes: ["190295328709"],
  },
  {
    discogsReleaseId: 1503928,
    artist: "Gasolin'",
    title: "Gas 5",
    label: "CBS",
    catalogNumber: "CBS 69209",
    country: "Denmark",
    pressingYear: 1975,
    originalYear: 1975,
    format: "Vinyl, LP, Album",
    coverImageUrl: fakeCoverUrl(1503928),
    barcodes: ["5099969209017"],
  },
];

export function priceLadder(nearMint: number, currency: Money["currency"] = "EUR"): FakePrices {
  const factors = [1.25, 1, 0.75, 0.5, 0.32, 0.22, 0.12, 0.06];
  return Object.fromEntries(conditions.map((condition, index) => [condition, { amount: Math.round(nearMint * factors[index]! * 100) / 100, currency }]));
}

export const samplePrices: Record<number, FakePrices> = {
  2335811: priceLadder(32),
  2474032: priceLadder(28),
  7371225: priceLadder(24),
  16893476: priceLadder(45),
};

export const sampleLowestListings: Record<number, Money> = {
  2335811: { amount: 19.5, currency: "EUR" },
  7371225: { amount: 17, currency: "EUR" },
  16893476: { amount: 31, currency: "EUR" },
  1503928: { amount: 12, currency: "EUR" },
};

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
