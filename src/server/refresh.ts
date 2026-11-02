import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "./db.ts";
import type { Currency, DiscogsGateway } from "./discogs.ts";
import type { ExchangeRates } from "./exchange-rates.ts";
import { collectionValue } from "./listing.ts";
import { collections, collectionValues, copies, users, valueRefreshes, valueSnapshots } from "./schema.ts";
import type { SecretBox } from "./secret-box.ts";
import { createValuation } from "./valuation.ts";

/**
 * Discogs allows 60 authenticated requests a minute per account. A Copy's Value takes two (price suggestions and
 * marketplace stats), and the refresh keeps to 50 a minute so the Owner can still use the app while it runs.
 */
const requestsPerMinute = 50;
const requestsPerCopy = 2;
export const pauseBetweenCopiesMs = (60_000 / requestsPerMinute) * requestsPerCopy;

export type RefreshOptions = {
  database: Database;
  discogs: DiscogsGateway;
  exchangeRates: ExchangeRates;
  secretBox: SecretBox;
  now: () => Date;
  wait: (ms: number) => Promise<void>;
};

export type RefreshResult = { month: string; collections: number; copies: number; finished: boolean };

/**
 * The monthly refresh: a new Value for every Copy in every Collection, fetched with its Owner's Discogs account in
 * the Owner's currency, and then the Collection value. One refresh per calendar month (UTC). Everything it records
 * names the refresh, so a run that stops partway carries on with the Copies and Collections it hasn't done yet.
 * A Copy Discogs fails to value keeps its earlier Value in the Collection value.
 */
export function createRefresh({ database, discogs, exchangeRates, secretBox, now, wait }: RefreshOptions) {
  const { db } = database;
  const valuation = createValuation({ database, discogs, exchangeRates, now });

  async function refreshOfThisMonth() {
    const month = now().toISOString().slice(0, 7);
    await db.insert(valueRefreshes).values({ month, startedAt: now() }).onConflictDoNothing();
    const [refresh] = await db.select().from(valueRefreshes).where(eq(valueRefreshes.month, month));
    return refresh!;
  }

  async function collectionsToDo(refreshId: string) {
    return db
      .select({ id: collections.id, ownerId: users.id, currency: users.currency, token: users.discogsAccessToken, secret: users.discogsAccessSecret })
      .from(collections)
      .innerJoin(users, eq(users.id, collections.ownerId))
      .leftJoin(collectionValues, and(eq(collectionValues.collectionId, collections.id), eq(collectionValues.refreshId, refreshId)))
      .where(sql`${collectionValues.refreshId} is null`)
      .orderBy(asc(collections.createdAt), asc(collections.id));
  }

  async function copiesToDo(refreshId: string, collectionId: string) {
    return db
      .select({ id: copies.id, discogsReleaseId: copies.discogsReleaseId, mediaCondition: copies.mediaCondition })
      .from(copies)
      .leftJoin(valueSnapshots, and(eq(valueSnapshots.copyId, copies.id), eq(valueSnapshots.refreshId, refreshId)))
      .where(and(eq(copies.collectionId, collectionId), sql`${valueSnapshots.id} is null`))
      .orderBy(asc(copies.createdAt), asc(copies.id));
  }

  async function recordCollectionValue(refreshId: string, collectionId: string, currency: Currency) {
    const { value, copies: count } = await collectionValue(database, collectionId, currency);
    await db.insert(collectionValues).values({ refreshId, collectionId, value, currency, copies: count, recordedAt: now() }).onConflictDoNothing();
  }

  return {
    async run(): Promise<RefreshResult> {
      const refresh = await refreshOfThisMonth();
      const result = { month: refresh.month, collections: 0, copies: 0, finished: true };
      if (refresh.finishedAt) return result;
      for (const collection of await collectionsToDo(refresh.id)) {
        const owner = { userId: collection.ownerId, currency: collection.currency, auth: { token: secretBox.open(collection.token), secret: secretBox.open(collection.secret) } };
        for (const copy of await copiesToDo(refresh.id, collection.id)) {
          await wait(pauseBetweenCopiesMs);
          const outcome = await valuation.fetchValue(copy, owner, refresh.id);
          if (outcome.kind === "valued") result.copies += 1;
        }
        await recordCollectionValue(refresh.id, collection.id, collection.currency);
        result.collections += 1;
      }
      if (result.finished) await db.update(valueRefreshes).set({ finishedAt: now() }).where(eq(valueRefreshes.id, refresh.id));
      return result;
    },
  };
}
