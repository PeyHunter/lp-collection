/** The Discogs grading scale, best first, spelled as the Discogs API spells it. */
export const conditions = [
  "Mint (M)",
  "Near Mint (NM or M-)",
  "Very Good Plus (VG+)",
  "Very Good (VG)",
  "Good Plus (G+)",
  "Good (G)",
  "Fair (F)",
  "Poor (P)",
] as const;

export type Condition = (typeof conditions)[number];

export const defaultCondition: Condition = "Very Good Plus (VG+)";

/** Discogs grades a sleeve on the same scale, plus three grades for a sleeve that can't be graded that way. */
export const sleeveConditions = [...conditions, "Generic", "Not Graded", "No Cover"] as const;

export type SleeveCondition = (typeof sleeveConditions)[number];

/** The currencies a User can choose. Discogs quotes only some of them, so Values are converted. */
export const currencies = ["DKK", "EUR", "SEK", "NOK", "GBP", "USD", "CHF", "CAD", "AUD", "NZD", "JPY", "MXN", "BRL", "ZAR"] as const;

export type Currency = (typeof currencies)[number];

export const defaultCurrency: Currency = "DKK";

/** The currencies Discogs' marketplace stats can be asked for (`curr_abbr`). */
export const discogsCurrencies = ["USD", "GBP", "EUR", "CAD", "AUD", "JPY", "CHF", "MXN", "BRL", "NZD", "SEK", "ZAR"] as const satisfies readonly Currency[];

export type DiscogsCurrency = (typeof discogsCurrencies)[number];

export function isCurrency(value: unknown): value is Currency {
  return (currencies as readonly unknown[]).includes(value);
}

export type Money = { amount: number; currency: Currency };

/** Discogs prices every Media condition at once, or refuses until the User fills in their seller settings. */
export type PriceSuggestions =
  | { kind: "suggested"; prices: Partial<Record<Condition, Money>> }
  | { kind: "seller-settings-missing" };

export type ReleaseCandidate = {
  discogsReleaseId: number;
  artist: string;
  title: string;
  label: string | null;
  catalogNumber: string | null;
  country: string | null;
  pressingYear: number | null;
  format: string | null;
  coverImageUrl: string | null;
};

/** What a User has to find a Release by. Each Lookup uses exactly one of the three ways. */
export type LookupQuery = { barcode: string } | { catalogNumber: string } | { artist: string; title: string };

/** Discogs' first page of matches, and how many matched in all. */
export type LookupResult = { candidates: ReleaseCandidate[]; total: number };

export const lookupPageSize = 25;

export type Release = {
  discogsReleaseId: number;
  artist: string;
  title: string;
  label: string | null;
  catalogNumber: string | null;
  country: string | null;
  pressingYear: number | null;
  originalYear: number | null;
  coverImageUrl: string | null;
};

export type DiscogsAuth = {
  token: string;
  secret: string;
};

export type LoginStart = {
  requestToken: string;
  requestSecret: string;
  authorizeUrl: string;
};

export type LoginCallback = {
  requestToken: string;
  requestSecret: string;
  verifier: string;
};

export type DiscogsIdentity = {
  discogsUserId: number;
  discogsUsername: string;
  accessToken: string;
  accessSecret: string;
};

/** The only way the app talks to Discogs. Tests use a scripted fake. */
export type DiscogsGateway = {
  lookup(query: LookupQuery, auth: DiscogsAuth): Promise<LookupResult>;
  release(discogsReleaseId: number, auth: DiscogsAuth): Promise<Release | undefined>;
  priceSuggestions(discogsReleaseId: number, auth: DiscogsAuth): Promise<PriceSuggestions>;
  /** The cheapest asking price right now in any condition, or null when nothing is for sale. */
  lowestListing(discogsReleaseId: number, currency: DiscogsCurrency, auth: DiscogsAuth): Promise<Money | null>;
  sellerSettingsUrl: string;
  startLogin(callbackUrl: string): Promise<LoginStart>;
  finishLogin(callback: LoginCallback): Promise<DiscogsIdentity>;
};
