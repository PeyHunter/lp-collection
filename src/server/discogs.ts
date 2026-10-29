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

/** A Release as a Lookup returns it, before the User picks one. `year` is the Pressing year. */
export type ReleaseCandidate = {
  discogsReleaseId: number;
  artist: string;
  title: string;
  label: string | null;
  catalogNumber: string | null;
  country: string | null;
  year: number | null;
  format: string | null;
  coverImageUrl: string | null;
};

/** The Release details the app keeps once a User saves a Copy of it. */
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

/** A User's Discogs OAuth access token. Discogs counts its rate limit per token. */
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
  lookupByBarcode(barcode: string, auth: DiscogsAuth): Promise<ReleaseCandidate[]>;
  release(discogsReleaseId: number, auth: DiscogsAuth): Promise<Release>;
  startLogin(callbackUrl: string): Promise<LoginStart>;
  finishLogin(callback: LoginCallback): Promise<DiscogsIdentity>;
};
