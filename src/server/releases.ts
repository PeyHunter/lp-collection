import { eq } from "drizzle-orm";
import type { Database } from "./db.ts";
import type { DiscogsAuth, DiscogsGateway } from "./discogs.ts";
import { releases } from "./schema.ts";

/** Keeps a Release's details from Discogs the first time a Copy needs them. Answers false when Discogs has no such Release. */
export async function cacheRelease({ db }: Database, discogs: DiscogsGateway, now: () => Date, discogsReleaseId: number, auth: DiscogsAuth) {
  const [cached] = await db.select({ id: releases.discogsReleaseId }).from(releases).where(eq(releases.discogsReleaseId, discogsReleaseId));
  if (cached) return true;
  const release = await discogs.release(discogsReleaseId, auth);
  if (!release) return false;
  await db
    .insert(releases)
    .values({ ...release, fetchedAt: now() })
    .onConflictDoNothing();
  return true;
}
