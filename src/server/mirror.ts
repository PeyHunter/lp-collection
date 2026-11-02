import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "./db.ts";
import type { CollectionItem, DiscogsAuth, DiscogsGateway } from "./discogs.ts";
import { collections, copies, mirrorJobs, users } from "./schema.ts";
import type { SecretBox } from "./secret-box.ts";

/** Discogs allows 60 requests a minute per account. The mirror keeps to 40, leaving the rest for the app itself. */
export const mirrorCallsPerMinute = 40;
/** How long a failed job waits before its next try: a minute, then 5 and 30 minutes, then 2 and 6 hours. */
const retryAfterMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
/** A job being run is claimed for this long, so a crashed run's job is tried again later and never twice at once. */
const claimMs = 5 * 60_000;
/** Discogs calls each kind of job makes: setting the fields writes Media condition, Sleeve condition and Notes. */
const callsFor = { add: 1, update: 3, remove: 1 } as const;

type Job = typeof mirrorJobs.$inferSelect;
type MirroredCopy = Pick<typeof copies.$inferSelect, "id" | "collectionId" | "discogsReleaseId" | "discogsFolderId" | "discogsInstanceId">;
type Owner = { userId: string; discogsUsername: string; auth: DiscogsAuth };

const itemOf = (row: { discogsReleaseId: number; discogsFolderId: number | null; discogsInstanceId: number | null }): CollectionItem | undefined =>
  row.discogsFolderId === null || row.discogsInstanceId === null
    ? undefined
    : { discogsReleaseId: row.discogsReleaseId, folderId: row.discogsFolderId, instanceId: row.discogsInstanceId };

/**
 * Mirrors each add, change and delete of a Copy one way into the Owner's Discogs collection (ADR-0002), with the
 * Owner's Discogs account whoever made the change. Each change is a job in the database, tried at once in the
 * background; a Discogs failure never blocks the change in the app, and the job is tried again later.
 */
export function createMirror({ database, discogs, secretBox, now }: { database: Database; discogs: DiscogsGateway; secretBox: SecretBox; now: () => Date }) {
  const { db } = database;
  const recentCalls = new Map<string, number[]>();
  let running: Promise<void> | undefined;
  let again = false;

  function withinBudget(ownerId: string, calls: number) {
    const since = now().getTime() - 60_000;
    const recent = (recentCalls.get(ownerId) ?? []).filter((at) => at > since);
    recentCalls.set(ownerId, recent);
    if (recent.length + calls > mirrorCallsPerMinute) return false;
    recent.push(...Array(calls).fill(now().getTime()));
    return true;
  }

  async function enqueue(kind: Job["kind"], copy: MirroredCopy) {
    await db.insert(mirrorJobs).values({
      copyId: copy.id,
      collectionId: copy.collectionId,
      kind,
      discogsReleaseId: copy.discogsReleaseId,
      discogsFolderId: copy.discogsFolderId,
      discogsInstanceId: copy.discogsInstanceId,
      nextAttemptAt: now(),
      createdAt: now(),
    });
  }

  const unclaimed = () => or(isNull(mirrorJobs.claimedUntil), lt(mirrorJobs.claimedUntil, now()));

  /** The oldest job of each Copy that is due and not being run. */
  async function dueJobs() {
    return db
      .select()
      .from(mirrorJobs)
      .where(
        and(
          sql`${mirrorJobs.nextAttemptAt} <= ${now().toISOString()}::timestamptz`,
          unclaimed(),
          sql`not exists (select 1 from mirror_jobs earlier where earlier.copy_id = ${mirrorJobs.copyId} and earlier.id < ${mirrorJobs.id})`,
        ),
      )
      .orderBy(asc(mirrorJobs.id))
      .limit(100);
  }

  async function ownerOf(collectionId: string): Promise<Owner> {
    const [row] = await db
      .select({ userId: users.id, discogsUsername: users.discogsUsername, token: users.discogsAccessToken, secret: users.discogsAccessSecret })
      .from(collections)
      .innerJoin(users, eq(users.id, collections.ownerId))
      .where(eq(collections.id, collectionId));
    return { userId: row!.userId, discogsUsername: row!.discogsUsername, auth: { token: secretBox.open(row!.token), secret: secretBox.open(row!.secret) } };
  }

  async function claim(job: Job) {
    const [claimed] = await db
      .update(mirrorJobs)
      .set({ claimedUntil: new Date(now().getTime() + claimMs) })
      .where(and(eq(mirrorJobs.id, job.id), unclaimed()))
      .returning();
    return claimed;
  }

  async function perform(job: Job, owner: Owner) {
    if (job.kind === "add") {
      const item = await discogs.addToCollection(owner.discogsUsername, job.discogsReleaseId, owner.auth);
      const [copy] = await db
        .update(copies)
        .set({ discogsFolderId: item.folderId, discogsInstanceId: item.instanceId })
        .where(eq(copies.id, job.copyId))
        .returning();
      // Deleted while Discogs was adding it: take the new item straight out again.
      if (!copy) return discogs.removeFromCollection(owner.discogsUsername, item, owner.auth);
      return enqueue("update", copy);
    }
    if (job.kind === "update") {
      const [copy] = await db.select().from(copies).where(eq(copies.id, job.copyId));
      const item = copy && itemOf(copy);
      if (!copy || !item) return;
      return discogs.setCollectionFields(owner.discogsUsername, item, { mediaCondition: copy.mediaCondition, sleeveCondition: copy.sleeveCondition, note: copy.note }, owner.auth);
    }
    const item = itemOf(job);
    if (item) await discogs.removeFromCollection(owner.discogsUsername, item, owner.auth);
  }

  /** Runs every due job the Owners' budgets allow. Answers how many ran, so a run can go on with the jobs they made. */
  async function runBatch() {
    let ran = 0;
    for (const job of await dueJobs()) {
      const owner = await ownerOf(job.collectionId);
      if (!withinBudget(owner.userId, callsFor[job.kind])) continue;
      if (!(await claim(job))) continue;
      ran += 1;
      try {
        await perform(job, owner);
        await db.delete(mirrorJobs).where(eq(mirrorJobs.id, job.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Mirroring ${job.kind} of Copy ${job.copyId} to Discogs failed (try ${job.attempts + 1}): ${message}`);
        await db
          .update(mirrorJobs)
          .set({
            attempts: job.attempts + 1,
            nextAttemptAt: new Date(now().getTime() + retryAfterMs[Math.min(job.attempts, retryAfterMs.length - 1)]!),
            claimedUntil: null,
            lastError: message.slice(0, 1000),
          })
          .where(eq(mirrorJobs.id, job.id));
      }
    }
    return ran;
  }

  /** Runs the due jobs. A call while a run is going makes that run look once more, so nothing waits for the next tick. */
  function runDue(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do again = false;
      while ((await runBatch()) > 0 || again);
    })().finally(() => {
      running = undefined;
    });
    return running;
  }

  function kick() {
    runDue().catch((error: unknown) => console.error(`The Discogs mirror stopped: ${error instanceof Error ? error.message : String(error)}`));
  }

  return {
    runDue,
    /** Settles once the run going now, if any, is done. */
    idle: () => running ?? Promise.resolve(),

    async copyAdded(copy: MirroredCopy) {
      await enqueue("add", copy);
      kick();
    },

    /** Only the conditions and the note are kept in step; one waiting update sends whatever they are when it runs. */
    async copyChanged(copy: MirroredCopy) {
      const [waiting] = await db
        .select({ id: mirrorJobs.id })
        .from(mirrorJobs)
        .where(and(eq(mirrorJobs.copyId, copy.id), eq(mirrorJobs.kind, "update"), isNull(mirrorJobs.claimedUntil)));
      if (!waiting) await enqueue("update", copy);
      kick();
    },

    /** A Copy that never reached Discogs just drops its jobs; one that did gets its item removed. */
    async copyDeleted(copy: MirroredCopy) {
      const dropped = await db
        .delete(mirrorJobs)
        .where(and(eq(mirrorJobs.copyId, copy.id), inArray(mirrorJobs.kind, ["add", "update"]), unclaimed()))
        .returning({ kind: mirrorJobs.kind });
      if (!dropped.some((job) => job.kind === "add")) await enqueue("remove", copy);
      kick();
    },

    /** The Copies with a change not in Discogs yet. */
    async pending(copyIds: string[]) {
      if (copyIds.length === 0) return new Set<string>();
      const rows = await db.selectDistinct({ copyId: mirrorJobs.copyId }).from(mirrorJobs).where(inArray(mirrorJobs.copyId, copyIds));
      return new Set(rows.map((row) => row.copyId));
    },
  };
}

export type Mirror = ReturnType<typeof createMirror>;
