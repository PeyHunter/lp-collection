/** A Release as a Lookup returns it, before the User picks one. */
export type ReleaseCandidate = {
  discogsReleaseId: number;
  artist: string;
  title: string;
};

/** Step one of the OAuth 1.0a handshake: where to send the person, and what to remember until they come back. */
export type LoginStart = {
  requestToken: string;
  requestSecret: string;
  authorizeUrl: string;
};

/** What the callback hands back, plus the request secret kept from `startLogin`. */
export type LoginCallback = {
  requestToken: string;
  requestSecret: string;
  verifier: string;
};

/** The Discogs account that just logged in, with the token the app uses on its behalf. */
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
