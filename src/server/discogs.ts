/** A Release as a Lookup returns it, before the User picks one. */
export type ReleaseCandidate = {
  discogsReleaseId: number;
  artist: string;
  title: string;
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
  lookupByBarcode(barcode: string): Promise<ReleaseCandidate[]>;
  startLogin(callbackUrl: string): Promise<LoginStart>;
  finishLogin(callback: LoginCallback): Promise<DiscogsIdentity>;
};
