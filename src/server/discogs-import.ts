import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "./db.ts";
import type { DiscogsAuth, DiscogsGateway } from "./discogs.ts";
import { cacheRelease } from "./releases.ts";
import { copies, discogsImports, users } from "./schema.ts";
import type { SecretBox } from "./secret-box.ts";

/**
 * Discogs allows 60 requests a minute per account. The import keeps to 40 (one every 1.5 s), leaving the rest for
 * the User, who is already using the app while it runs.
 */
export const importPauseMs = 60_000 / 40;
const retryAfterMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];
const claimMs = 10 * 60_000;

export type ImportProgress = { status: "running" | "done"; imported: number; total: number | null };

type Import = typeof discogsImports.$inferSelect;

/**
 * The once-only import of a new User's Discogs collection into their own Collection (ADR-0002), in the background.
 * Each item becomes a Copy with both conditions Very Good Plus that keeps its Discogs instance id, so the mirror never
 * adds it to Discogs again. An item already imported is skipped, so a page can safely be run twice.
 */
export function createImporter({
  database,
  discogs,
  secretBox,
  now,
  wait,
}: {
  database: Database;
  discogs: DiscogsGateway;
  secretBox: SecretBox;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
}) {
  const { db } = database;

  /** Waits its turn for each Discogs request the call makes, then makes it. */
  async function call<T>(request: () => Promise<T>, requests = 1) {
    for (let index = 0; index < requests; index++) await wait(importPauseMs);
    return request();
  }

  async function due() {
    return db
      .select()
      .from(discogsImports)
      .where(
        and(
          eq(discogsImports.status, "running"),
          sql`${discogsImports.nextAttemptAt} <= ${now().toISOString()}::timestamptz`,
          or(isNull(discogsImports.claimedUntil), lt(discogsImports.claimedUntil, now())),
        ),
      );
  }

  async function claim(job: Import) {
    const [claimed] = await db
      .update(discogsImports)
      .set({ claimedUntil: new Date(now().getTime() + claimMs) })
      .where(and(eq(discogsImports.userId, job.userId), or(isNull(discogsImports.claimedUntil), lt(discogsImports.claimedUntil, now()))))
      .returning();
    return claimed;
  }

  async function importPage(job: Import, discogsUsername: string, auth: DiscogsAuth) {
    const page = await call(() => discogs.collectionPage(discogsUsername, job.nextPage, auth));
    let imported = 0;
    for (const item of page.items) {
      const [already] = await db
        .select({ id: copies.id })
        .from(copies)
        .where(and(eq(copies.collectionId, job.collectionId), eq(copies.discogsInstanceId, item.instanceId)));
      if (already) continue;
      const known = await db.execute(sql`select 1 from releases where discogs_release_id = ${item.discogsReleaseId}`);
      const cached = known.rows.length > 0 || (await call(() => cacheRelease(database, discogs, now, item.discogsReleaseId, auth), 2));
      if (!cached) continue;
      await db.insert(copies).values({
        collectionId: job.collectionId,
        discogsReleaseId: item.discogsReleaseId,
        discogsFolderId: item.folderId,
        discogsInstanceId: item.instanceId,
        createdAt: now(),
      });
      imported += 1;
    }
    const finished = job.nextPage >= page.pages;
    const [next] = await db
      .update(discogsImports)
      .set({
        nextPage: job.nextPage + 1,
        imported: job.imported + imported,
        total: page.total,
        attempts: 0,
        status: finished ? "done" : "running",
        finishedAt: finished ? now() : null,
        lastError: null,
      })
      .where(eq(discogsImports.userId, job.userId))
      .returning();
    return next!;
  }

  async function runImport(job: Import) {
    const [user] = await db.select().from(users).where(eq(users.id, job.userId));
    const auth = { token: secretBox.open(user!.discogsAccessToken), secret: secretBox.open(user!.discogsAccessSecret) };
    let current = job;
    try {
      while (current.status === "running") current = await importPage(current, user!.discogsUsername, auth);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Importing ${user!.discogsUsername}'s Discogs collection stopped at page ${current.nextPage} (try ${current.attempts + 1}): ${message}`);
      await db
        .update(discogsImports)
        .set({ attempts: current.attempts + 1, nextAttemptAt: new Date(now().getTime() + retryAfterMs[Math.min(current.attempts, retryAfterMs.length - 1)]!), lastError: message.slice(0, 1000) })
        .where(eq(discogsImports.userId, job.userId));
    } finally {
      await db.update(discogsImports).set({ claimedUntil: null }).where(eq(discogsImports.userId, job.userId));
    }
  }

  /** Imports run side by side, one per User: each User's Discogs account has its own rate limit. */
  const runs = new Map<string, Promise<void>>();
  const inFlight = new Set<Promise<void>>();

  function track(promise: Promise<void>) {
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise)).catch(() => undefined);
    return promise;
  }

  /** Starts every due import that isn't running yet, and settles when they are done. */
  function runDue(): Promise<void> {
    return track(
      (async () => {
        const started: Promise<void>[] = [];
        for (const job of await due()) {
          if (runs.has(job.userId)) continue;
          const claimed = await claim(job);
          if (!claimed) continue;
          const run = runImport(claimed).finally(() => runs.delete(job.userId));
          runs.set(job.userId, run);
          started.push(track(run));
        }
        await Promise.all(started);
      })(),
    );
  }

  return {
    runDue,
    /** Settles once no import is running or being started. */
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
    kick() {
      runDue().catch((error: unknown) => console.error(`The Discogs import stopped: ${error instanceof Error ? error.message : String(error)}`));
    },
    async progress(userId: string): Promise<ImportProgress | undefined> {
      const [row] = await db.select().from(discogsImports).where(eq(discogsImports.userId, userId));
      return row && { status: row.status, imported: row.imported, total: row.total };
    },
  };
}

export type Importer = ReturnType<typeof createImporter>;
