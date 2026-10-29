import type { DiscogsGateway, ReleaseCandidate } from "./discogs.ts";

/** What the fake Discogs answers in a test, e.g. which Releases a barcode matches. */
export type FakeDiscogsScript = {
  releasesByBarcode?: Record<string, ReleaseCandidate[]>;
};

/** Stands in for Discogs in tests and local development until the real gateway exists. */
export function createFakeDiscogs(script: FakeDiscogsScript): DiscogsGateway {
  return {
    async lookupByBarcode(barcode) {
      return script.releasesByBarcode?.[barcode] ?? [];
    },
  };
}
