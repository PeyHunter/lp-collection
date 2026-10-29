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
  lookupByBarcode(barcode: string, auth: DiscogsAuth): Promise<ReleaseCandidate[]>;
  release(discogsReleaseId: number, auth: DiscogsAuth): Promise<Release>;
  startLogin(callbackUrl: string): Promise<LoginStart>;
  finishLogin(callback: LoginCallback): Promise<DiscogsIdentity>;
};
