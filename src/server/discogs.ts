/** A Release as a Lookup returns it, before the User picks one. */
export type ReleaseCandidate = {
  discogsReleaseId: number;
  artist: string;
  title: string;
};

/** The only way the app talks to Discogs. Tests use a scripted fake. */
export type DiscogsGateway = {
  lookupByBarcode(barcode: string): Promise<ReleaseCandidate[]>;
};
