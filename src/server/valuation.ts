import { and, desc, eq } from "drizzle-orm";
import type { Database } from "./db.ts";
import { discogsCurrencies, type Condition, type Currency, type DiscogsAuth, type DiscogsCurrency, type DiscogsGateway, type Money } from "./discogs.ts";
import type { ExchangeRates } from "./exchange-rates.ts";
import { copies, users, valueSnapshots } from "./schema.ts";

/** The latest Value fetched for a Copy's current Media condition. A null `value` means Discogs had no suggestion. */
export type CopyValue = {
  mediaCondition: Condition;
  value: number | null;
  lowestListing: number | null;
  currency: Currency;
  fetchedAt: string;
};

export type Valuer = { userId: string; currency: Currency; auth: DiscogsAuth };

export type ValuationOutcome = "valued" | "seller-settings-missing" | "unavailable";

type ValuedCopy = { id: string; discogsReleaseId: number; mediaCondition: Condition };

/** Discogs quotes the Lowest listing only in its own currencies; the euro is the nearest for the others (the krone is pegged to it). */
function statsCurrency(currency: Currency): DiscogsCurrency {
  return (discogsCurrencies as readonly Currency[]).includes(currency) ? (currency as DiscogsCurrency) : "EUR";
}

export function createValuation({ database, discogs, exchangeRates, now }: { database: Database; discogs: DiscogsGateway; exchangeRates: ExchangeRates; now: () => Date }) {
  const { db } = database;

  const inUserCurrency = async (money: Money | null | undefined, currency: Currency) =>
    money ? (await exchangeRates.convert(money, currency)).amount : null;

  async function markSellerSettings(userId: string, missing: boolean) {
    await db
      .update(users)
      .set({ sellerSettingsMissing: missing })
      .where(and(eq(users.id, userId), eq(users.sellerSettingsMissing, !missing)));
  }

  return {
    async fetchValue(copy: ValuedCopy, { userId, currency, auth }: Valuer): Promise<ValuationOutcome> {
      try {
        const suggestions = await discogs.priceSuggestions(copy.discogsReleaseId, auth);
        if (suggestions.kind === "seller-settings-missing") {
          await markSellerSettings(userId, true);
          return "seller-settings-missing";
        }
        const lowest = await discogs.lowestListing(copy.discogsReleaseId, statsCurrency(currency), auth);
        await db.insert(valueSnapshots).values({
          copyId: copy.id,
          mediaCondition: copy.mediaCondition,
          value: await inUserCurrency(suggestions.prices[copy.mediaCondition], currency),
          lowestListing: await inUserCurrency(lowest, currency),
          currency,
          fetchedAt: now(),
        });
        await markSellerSettings(userId, false);
        return "valued";
      } catch (error) {
        console.error(`Value of Release ${copy.discogsReleaseId} failed: ${error instanceof Error ? error.message : String(error)}`);
        return "unavailable";
      }
    },

    async currentValues(filter: { collectionId: string } | { copyId: string }, currency: Currency) {
      const rows = await db
        .selectDistinctOn([valueSnapshots.copyId], {
          copyId: valueSnapshots.copyId,
          mediaCondition: valueSnapshots.mediaCondition,
          value: valueSnapshots.value,
          lowestListing: valueSnapshots.lowestListing,
          currency: valueSnapshots.currency,
          fetchedAt: valueSnapshots.fetchedAt,
        })
        .from(valueSnapshots)
        .innerJoin(copies, and(eq(copies.id, valueSnapshots.copyId), eq(copies.mediaCondition, valueSnapshots.mediaCondition)))
        .where("collectionId" in filter ? eq(copies.collectionId, filter.collectionId) : eq(copies.id, filter.copyId))
        .orderBy(valueSnapshots.copyId, desc(valueSnapshots.fetchedAt), desc(valueSnapshots.id));
      return new Map<string, CopyValue>(
        rows.filter((row) => row.currency === currency).map(({ copyId, fetchedAt, ...value }) => [copyId, { ...value, fetchedAt: fetchedAt.toISOString() }]),
      );
    },
  };
}

export type Valuation = ReturnType<typeof createValuation>;
