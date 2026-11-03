import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { collectionPageSize, conditions, isCurrency, lookupPageSize, type CollectionFields, type CollectionItem, type Condition, type DiscogsAuth, type DiscogsGateway, type LookupQuery, type Money, type PriceSuggestions, type Release, type ReleaseCandidate } from "./discogs.ts";

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

  async function send(method: "GET" | "POST" | "DELETE", path: string, tokenSecret: string, params: Record<string, string>, deadline: number, json?: object) {
    await waitForTurn(path, deadline);
    return fetch(`${apiBaseUrl}${path}`, {
      method,
      body: json && JSON.stringify(json),
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
        "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded",
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
    return requestAs(auth, "GET", path);
  }

  /** One request as the user, sent again after a short wait while Discogs answers 429 (too many requests). */
  async function requestAs(auth: DiscogsAuth, method: "GET" | "POST" | "DELETE", path: string, json?: object) {
    const deadline = Date.now() + maxWaitMs;
    for (let retry = 0; ; retry++) {
      const response = await send(method, path, auth.secret, { oauth_token: auth.token }, deadline, json);
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

  async function changeAs(auth: DiscogsAuth, method: "POST" | "DELETE", path: string, json?: object) {
    const response = await requestAs(auth, method, path, json);
    if (!response.ok) throw new Error(`Discogs answered ${method} ${path} with HTTP ${response.status}: ${await response.text()}`);
    return response;
  }

  /** Each Discogs user numbers their collection fields; the default Media Condition, Sleeve Condition and Notes are found by name. */
  const fieldIds = new Map<string, Promise<Record<keyof CollectionFields, number>>>();
  function collectionFieldIds(discogsUsername: string, auth: DiscogsAuth) {
    const key = discogsUsername.toLowerCase();
    let ids = fieldIds.get(key);
    if (!ids) {
      ids = (async () => {
        const { fields = [] } = ((await getAs(auth, `/users/${encodeURIComponent(discogsUsername)}/collection/fields`)) ?? {}) as { fields?: { id: number; name: string }[] };
        const idOf = (name: string) => {
          const field = fields.find((each) => each.name.toLowerCase() === name.toLowerCase());
          if (!field) throw new Error(`${discogsUsername}'s Discogs collection has no "${name}" field`);
          return field.id;
        };
        return { mediaCondition: idOf("Media Condition"), sleeveCondition: idOf("Sleeve Condition"), note: idOf("Notes") };
      })();
      ids.catch(() => fieldIds.delete(key));
      fieldIds.set(key, ids);
    }
    return ids;
  }

  const itemPath = (discogsUsername: string, { folderId, discogsReleaseId, instanceId }: CollectionItem) =>
    `/users/${encodeURIComponent(discogsUsername)}/collection/folders/${folderId}/releases/${discogsReleaseId}/instances/${instanceId}`;

  return {
    async collectionPage(discogsUsername, page, auth) {
      const path = `/users/${encodeURIComponent(discogsUsername)}/collection/folders/0/releases?${new URLSearchParams({ page: String(page), per_page: String(collectionPageSize), sort: "added", sort_order: "asc" })}`;
      const answer = ((await getAs(auth, path)) ?? {}) as { pagination?: { pages?: number; items?: number }; releases?: { id: number; instance_id: number; folder_id: number }[] };
      const items = (answer.releases ?? []).map((release) => ({ discogsReleaseId: release.id, folderId: release.folder_id, instanceId: release.instance_id }));
      return { items, pages: answer.pagination?.pages ?? 1, total: answer.pagination?.items ?? items.length };
    },
    async addToCollection(discogsUsername, discogsReleaseId, auth) {
      const folderId = 1;
      const response = await changeAs(auth, "POST", `/users/${encodeURIComponent(discogsUsername)}/collection/folders/${folderId}/releases/${discogsReleaseId}`);
      const { instance_id: instanceId } = (await response.json()) as { instance_id?: unknown };
      if (typeof instanceId !== "number") throw new Error(`Discogs added Release ${discogsReleaseId} to ${discogsUsername}'s collection but sent no instance id`);
      return { discogsReleaseId, folderId, instanceId };
    },
    async setCollectionFields(discogsUsername, item, fields, auth) {
      const ids = await collectionFieldIds(discogsUsername, auth);
      for (const name of ["mediaCondition", "sleeveCondition", "note"] as const) {
        await changeAs(auth, "POST", `${itemPath(discogsUsername, item)}/fields/${ids[name]}`, { value: fields[name] ?? "" });
      }
    },
    async removeFromCollection(discogsUsername, item, auth) {
      const path = itemPath(discogsUsername, item);
      const response = await requestAs(auth, "DELETE", path);
      if (!response.ok && response.status !== 404) throw new Error(`Discogs answered DELETE ${path} with HTTP ${response.status}: ${await response.text()}`);
    },
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
    async lookup(query, auth) {
      const params = new URLSearchParams({ ...searchTerms(query), type: "release", per_page: String(lookupPageSize) });
      const search = (await getAs(auth, `/database/search?${params}`)) as { results?: SearchResult[]; pagination?: { items?: number } } | undefined;
      const candidates = (search?.results ?? []).map(candidateFrom);
      return { candidates, total: search?.pagination?.items ?? candidates.length };
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
  formats?: { text?: string }[];
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
  genres?: string[];
  styles?: string[];
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

/** A barcode is exact, so it searches every format. Typed text matches CDs and cassettes too, so it searches vinyl only. */
function searchTerms(query: LookupQuery): Record<string, string> {
  if ("barcode" in query) return { barcode: query.barcode };
  if ("catalogNumber" in query) return { catno: query.catalogNumber, format: "Vinyl" };
  return {
    ...(query.artist && { artist: query.artist }),
    ...(query.title && { release_title: query.title }),
    format: "Vinyl",
  };
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
    formats: formatsOf(result),
    coverImageUrl: result.cover_image && !result.cover_image.endsWith("/spacer.gif") ? result.cover_image : null,
  };
}

/** `format` holds the standard words; `formats[].text` holds free text such as "Red Marbled" or "180 Gram". */
function formatsOf(result: SearchResult): string[] {
  const words = [...(result.format ?? []), ...(result.formats ?? []).map((format) => format.text ?? "")];
  return [...new Set(words.map((word) => word.trim()).filter((word) => word !== ""))];
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
    genres: release.genres ?? [],
    styles: release.styles ?? [],
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
