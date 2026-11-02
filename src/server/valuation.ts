import { and, desc, eq } from "drizzle-orm";
import type { Database } from "./db.ts";
import { discogsCurrencies, type Condition, type Currency, type DiscogsAuth, type DiscogsCurrency, type DiscogsGateway, type Money } from "./discogs.ts";
import type { ExchangeRates } from "./exchange-rates.ts";
import { copies, users, valueSnapshots } from "./schema.ts";

/**
 * The latest Value fetched for a Copy's current Media condition: Discogs' suggestion for that condition, or the Lowest
 * listing while the User has no Discogs seller settings. A null `value` means Discogs had neither.
 */
export type CopyValue = {
  mediaCondition: Condition;
  value: number | null;
  lowestListing: number | null;
  currency: Currency;
  fetchedAt: string;
};

export type Valuer = { userId: string; currency: Currency; auth: DiscogsAuth };

/** `sellerSettingsMissing` says the Value is the Lowest listing, because Discogs suggests prices only with seller settings. */
export type ValuationOutcome = { kind: "valued"; sellerSettingsMissing: boolean } | { kind: "unavailable" };

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
    async fetchValue(copy: ValuedCopy, { userId, currency, auth }: Valuer, refreshId?: string): Promise<ValuationOutcome> {
      try {
        const suggestions = await discogs.priceSuggestions(copy.discogsReleaseId, auth);
        const sellerSettingsMissing = suggestions.kind === "seller-settings-missing";
        const lowestListing = await inUserCurrency(await discogs.lowestListing(copy.discogsReleaseId, statsCurrency(currency), auth), currency);
        await db.insert(valueSnapshots).values({
          copyId: copy.id,
          mediaCondition: copy.mediaCondition,
          value: sellerSettingsMissing ? lowestListing : await inUserCurrency(suggestions.prices[copy.mediaCondition], currency),
          lowestListing,
          currency,
          fetchedAt: now(),
          refreshId,
        });
        await markSellerSettings(userId, sellerSettingsMissing);
        return { kind: "valued", sellerSettingsMissing };
      } catch (error) {
        console.error(`Value of Release ${copy.discogsReleaseId} failed: ${error instanceof Error ? error.message : String(error)}`);
        return { kind: "unavailable" };
      }
    },

    async currentValue(copyId: string, currency: Currency): Promise<CopyValue | undefined> {
      const [row] = await db
        .select({
          mediaCondition: valueSnapshots.mediaCondition,
          value: valueSnapshots.value,
          lowestListing: valueSnapshots.lowestListing,
          currency: valueSnapshots.currency,
          fetchedAt: valueSnapshots.fetchedAt,
        })
        .from(valueSnapshots)
        .innerJoin(copies, and(eq(copies.id, valueSnapshots.copyId), eq(copies.mediaCondition, valueSnapshots.mediaCondition)))
        .where(and(eq(valueSnapshots.currency, currency), eq(copies.id, copyId)))
        .orderBy(desc(valueSnapshots.fetchedAt), desc(valueSnapshots.id))
        .limit(1);
      return row && { ...row, fetchedAt: row.fetchedAt.toISOString() };
    },
  };
}

export type Valuation = ReturnType<typeof createValuation>;
