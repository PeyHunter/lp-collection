import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { DiscogsAuth, DiscogsGateway, Release, ReleaseCandidate } from "./discogs.ts";

export type RealDiscogsOptions = {
  consumerKey: string;
  consumerSecret: string;
  apiBaseUrl?: string;
  webBaseUrl?: string;
  /** Discogs allows 60 authenticated requests a minute per token, so one a second keeps a token under it. */
  requestGapMs?: number;
  backoffMs?: number[];
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
  requestGapMs = 1000,
  backoffMs = [5_000, 15_000, 30_000],
}: RealDiscogsOptions): DiscogsGateway {
  const nextFreeAt = new Map<string, number>();

  async function waitForTurn(token: string) {
    const now = Date.now();
    const turn = Math.max(now, nextFreeAt.get(token) ?? 0);
    nextFreeAt.set(token, turn + requestGapMs);
    if (turn > now) await sleep(turn - now);
  }

  function send(method: "GET" | "POST", path: string, tokenSecret: string, params: Record<string, string>) {
    return fetch(`${apiBaseUrl}${path}`, {
      method,
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
    const response = await send(method, path, tokenSecret, params);
    if (!response.ok) throw new Error(`Discogs answered ${method} ${path} with HTTP ${response.status}: ${await response.text()}`);
    return response;
  }

  async function getAs(auth: DiscogsAuth, path: string): Promise<unknown> {
    for (let retry = 0; ; retry++) {
      await waitForTurn(auth.token);
      const response = await send("GET", path, auth.secret, { oauth_token: auth.token });
      if (response.status === 429 && retry < backoffMs.length) {
        await sleep(backoffMs[retry]!);
        continue;
      }
      if (!response.ok) throw new Error(`Discogs answered GET ${path} with HTTP ${response.status}: ${await response.text()}`);
      return response.json();
    }
  }

  async function tokenPair(response: Response) {
    const body = new URLSearchParams(await response.text());
    const token = body.get("oauth_token");
    const secret = body.get("oauth_token_secret");
    if (!token || !secret) throw new Error("Discogs sent no OAuth token");
    return { token, secret };
  }

  return {
    async lookupByBarcode(barcode, auth) {
      const search = (await getAs(auth, `/database/search?${new URLSearchParams({ barcode, type: "release", per_page: "50" })}`)) as {
        results?: SearchResult[];
      };
      return (search.results ?? []).map(candidateFrom);
    },
    async release(discogsReleaseId, auth) {
      const release = (await getAs(auth, `/releases/${discogsReleaseId}`)) as DiscogsRelease;
      const master = release.master_id ? ((await getAs(auth, `/masters/${release.master_id}`)) as { year?: number }) : undefined;
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
