import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { conditions, isCurrency, type Condition, type DiscogsAuth, type DiscogsGateway, type Money, type PriceSuggestions, type Release, type ReleaseCandidate } from "./discogs.ts";

export type RealDiscogsOptions = {
  consumerKey: string;
  consumerSecret: string;
  apiBaseUrl?: string;
  webBaseUrl?: string;
  /** Discogs counts requests per source IP, about 60 a minute, so every request from this process waits for one shared turn. */
  requestGapMs?: number;
  backoffMs?: number[];
  maxWaitMs?: number;
};

const requestTimeoutMs = 2_000;
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
  requestGapMs = 1000,
  backoffMs = [2_000, 4_000],
  maxWaitMs = 8_000,
}: RealDiscogsOptions): DiscogsGateway {
  let nextFreeAt = 0;

  async function waitForTurn(path: string, deadline: number) {
    const now = Date.now();
    const turn = Math.max(now, nextFreeAt);
    if (turn > deadline) throw new Error(`Too many requests are waiting for Discogs; ${path} was not sent`);
    nextFreeAt = turn + requestGapMs;
    if (turn > now) await sleep(turn - now);
  }

  async function send(method: "GET" | "POST", path: string, tokenSecret: string, params: Record<string, string>, deadline: number) {
    await waitForTurn(path, deadline);
    return fetch(`${apiBaseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 0) + requestTimeoutMs),
      headers: {
        Authorization: authorizationHeader({
          oauth_consumer_key: consumerKey,
          oauth_nonce: randomBytes(16).toString("hex"),
          oauth_signature: `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`,
          oauth_signature_method: "PLAINTEXT",
          oauth_timestamp: String(Math.floor(Date.now() / 1000)),
          ...params,
        }),
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
    });
  }

  async function call(method: "GET" | "POST", path: string, tokenSecret: string, params: Record<string, string>) {
    const response = await send(method, path, tokenSecret, params, Date.now() + maxWaitMs);
    if (!response.ok) throw new Error(`Discogs answered ${method} ${path} with HTTP ${response.status}: ${await response.text()}`);
    return response;
  }

  async function getResponseAs(auth: DiscogsAuth, path: string) {
    const deadline = Date.now() + maxWaitMs;
    for (let retry = 0; ; retry++) {
      const response = await send("GET", path, auth.secret, { oauth_token: auth.token }, deadline);
      const backoff = backoffMs[retry];
      if (response.status === 429 && backoff !== undefined && Date.now() + backoff <= deadline) {
        await sleep(backoff);
        continue;
      }
      return response;
    }
  }

  async function getAs(auth: DiscogsAuth, path: string): Promise<unknown> {
    const response = await getResponseAs(auth, path);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Discogs answered GET ${path} with HTTP ${response.status}: ${await response.text()}`);
    return response.json();
  }

  async function tokenPair(response: Response) {
    const body = new URLSearchParams(await response.text());
    const token = body.get("oauth_token");
    const secret = body.get("oauth_token_secret");
    if (!token || !secret) throw new Error("Discogs sent no OAuth token");
    return { token, secret };
  }

  return {
    sellerSettingsUrl: `${webBaseUrl}/settings/seller`,
    async priceSuggestions(discogsReleaseId, auth) {
      return priceSuggestionsFrom(await getResponseAs(auth, `/marketplace/price_suggestions/${discogsReleaseId}`));
    },
    async lowestListing(discogsReleaseId, currency, auth) {
      const stats = (await getAs(auth, `/marketplace/stats/${discogsReleaseId}?${new URLSearchParams({ curr_abbr: currency })}`)) as
        | { lowest_price?: unknown }
        | undefined;
      return moneyFrom(stats?.lowest_price);
    },
    async lookupByBarcode(barcode, auth) {
      const search = (await getAs(auth, `/database/search?${new URLSearchParams({ barcode, type: "release", per_page: "50" })}`)) as
        | { results?: SearchResult[] }
        | undefined;
      return (search?.results ?? []).map(candidateFrom);
    },
    async release(discogsReleaseId, auth) {
      const release = (await getAs(auth, `/releases/${discogsReleaseId}`)) as DiscogsRelease | undefined;
      if (!release) return undefined;
      const master = release.master_id ? ((await getAs(auth, `/masters/${release.master_id}`)) as { year?: number } | undefined) : undefined;
      return releaseFrom(release, master);
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

type SearchResult = {
  id: number;
  title?: string;
  country?: string;
  year?: string;
  label?: string[];
  catno?: string;
  format?: string[];
  cover_image?: string;
};

type DiscogsRelease = {
  id: number;
  title?: string;
  artists?: { name: string; join?: string }[];
  labels?: { name: string; catno?: string }[];
  country?: string;
  year?: number;
  master_id?: number;
  images?: { type?: string; uri?: string }[];
};

/**
 * Discogs refuses price suggestions with a 4xx whose message names the seller settings
 * ("You must fill out your seller settings first.", seen as 404 and as 400). Any other 404 means no suggestion.
 */
export async function priceSuggestionsFrom(response: Response): Promise<PriceSuggestions> {
  if (!response.ok) {
    const body = await response.text();
    if (response.status >= 400 && response.status < 500 && /seller settings/i.test(body)) return { kind: "seller-settings-missing" };
    if (response.status === 404) return { kind: "suggested", prices: {} };
    throw new Error(`Discogs answered GET ${new URL(response.url || "http://discogs").pathname} with HTTP ${response.status}: ${body}`);
  }
  const suggestions = (await response.json()) as Record<string, unknown>;
  const prices: Partial<Record<Condition, Money>> = {};
  for (const condition of conditions) {
    const price = moneyFrom(suggestions[condition]);
    if (price) prices[condition] = price;
  }
  return { kind: "suggested", prices };
}

function moneyFrom(price: unknown): Money | null {
  const { currency, value } = (price ?? {}) as { currency?: unknown; value?: unknown };
  if (!isCurrency(currency) || typeof value !== "number" || !(value > 0)) return null;
  return { amount: Math.round(value * 100) / 100, currency };
}

function candidateFrom(result: SearchResult): ReleaseCandidate {
  const [artist, ...title] = (result.title ?? "").split(" - ");
  return {
    discogsReleaseId: result.id,
    artist: title.length > 0 ? withoutNumbering(artist!) : "",
    title: title.length > 0 ? title.join(" - ") : artist!,
    label: result.label?.[0] ? withoutNumbering(result.label[0]) : null,
    catalogNumber: catalogNumber(result.catno),
    country: result.country || null,
    pressingYear: year(result.year),
    format: result.format?.length ? result.format.join(", ") : null,
    coverImageUrl: result.cover_image && !result.cover_image.endsWith("/spacer.gif") ? result.cover_image : null,
  };
}

function releaseFrom(release: DiscogsRelease, master: { year?: number } | undefined): Release {
  const pressingYear = year(release.year);
  const image = release.images?.find((candidate) => candidate.type === "primary") ?? release.images?.[0];
  const [label] = release.labels ?? [];
  return {
    discogsReleaseId: release.id,
    artist: artistCredit(release.artists ?? []),
    title: release.title ?? "",
    label: label ? withoutNumbering(label.name) : null,
    catalogNumber: catalogNumber(label?.catno),
    country: release.country || null,
    pressingYear,
    originalYear: year(master?.year) ?? pressingYear,
    coverImageUrl: image?.uri || null,
  };
}

function artistCredit(artists: { name: string; join?: string }[]) {
  return artists
    .map(({ name, join }, index) => {
      const last = index === artists.length - 1;
      const separator = last ? "" : !join ? " & " : join === "," ? ", " : ` ${join} `;
      return withoutNumbering(name) + separator;
    })
    .join("");
}

/** Discogs tells same-named artists and labels apart with a suffix, as in "Nirvana (2)". */
function withoutNumbering(name: string) {
  return name.replace(/ \(\d+\)$/, "");
}

function catalogNumber(catno: string | undefined) {
  return catno && catno.toLowerCase() !== "none" ? catno : null;
}

function year(value: string | number | undefined) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function authorizationHeader(params: Record<string, string>) {
  return `OAuth ${Object.entries(params)
    .map(([name, value]) => `${name}="${percentEncode(value)}"`)
    .join(", ")}`;
}

function percentEncode(text: string) {
  return encodeURIComponent(text).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
