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
  formats: string[];
  coverImageUrl: string | null;
};

export type LookupQuery = { barcode: string } | { artist: string; title: string };

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
  genres: string[];
  styles: string[];
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

/** Where a Copy sits in its Owner's Discogs collection. New items go in folder 1, "Uncategorized". */
export type CollectionItem = { discogsReleaseId: number; folderId: number; instanceId: number };

/** What the app keeps in step on a Discogs collection item. A null note clears the Notes field. */
export type CollectionFields = { mediaCondition: Condition; sleeveCondition: SleeveCondition; note: string | null };

/** Discogs lists a collection at most this many items a page. */
export const collectionPageSize = 100;

export type CollectionPage = { items: CollectionItem[]; pages: number; total: number };

/** The only way the app talks to Discogs. Tests use a scripted fake. */
export type DiscogsGateway = {
  lookup(query: LookupQuery, auth: DiscogsAuth): Promise<LookupResult>;
  release(discogsReleaseId: number, auth: DiscogsAuth): Promise<Release | undefined>;
  priceSuggestions(discogsReleaseId: number, auth: DiscogsAuth): Promise<PriceSuggestions>;
  /** The cheapest asking price right now in any condition, or null when nothing is for sale. */
  lowestListing(discogsReleaseId: number, currency: DiscogsCurrency, auth: DiscogsAuth): Promise<Money | null>;
  sellerSettingsUrl: string;
  /** One page of everything in the user's Discogs collection, across all folders, oldest added first. Pages count from 1. */
  collectionPage(discogsUsername: string, page: number, auth: DiscogsAuth): Promise<CollectionPage>;
  /** Adds the Release to the user's Discogs collection once more, as a new item. */
  addToCollection(discogsUsername: string, discogsReleaseId: number, auth: DiscogsAuth): Promise<CollectionItem>;
  setCollectionFields(discogsUsername: string, item: CollectionItem, fields: CollectionFields, auth: DiscogsAuth): Promise<void>;
  /** Removes one item. An item Discogs no longer has counts as removed. */
  removeFromCollection(discogsUsername: string, item: CollectionItem, auth: DiscogsAuth): Promise<void>;
  startLogin(callbackUrl: string): Promise<LoginStart>;
  finishLogin(callback: LoginCallback): Promise<DiscogsIdentity>;
};
