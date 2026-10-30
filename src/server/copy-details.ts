import { conditions, currencies, isCurrency, sleeveConditions, type Condition, type Currency, type Money, type SleeveCondition } from "./discogs.ts";
import type { ExchangeRates } from "./exchange-rates.ts";
import type { CopyValue } from "./valuation.ts";

/** The columns of a Copy that a Member can change. A null clears a detail. */
export type CopyChanges = Partial<{
  mediaCondition: Condition;
  sleeveCondition: SleeveCondition;
  note: string | null;
  purchasePrice: number | null;
  purchaseCurrency: Currency | null;
  purchaseDate: string | null;
}>;

type Parsed = { changes: CopyChanges } | { error: string };

export const maxNoteLength = 2000;
const maxAmount = 9_999_999_999.99;
const dayMs = 24 * 60 * 60 * 1000;

const isOneOf = (list: readonly string[], value: unknown) => typeof value === "string" && list.includes(value);

function isCents(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount <= maxAmount && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;
}

/** A calendar day as `YYYY-MM-DD`, no later than tomorrow in UTC so that today counts in every time zone. */
function isPurchaseDay(value: unknown, now: Date): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value) && value >= "1900-01-01" && day.getTime() <= now.getTime() + dayMs;
}

const fields: Record<string, { error: string; parse: (raw: unknown, now: Date) => CopyChanges | undefined }> = {
  mediaCondition: {
    error: "Say the new Media condition or Sleeve condition on the Discogs scale.",
    parse: (raw) => (isOneOf(conditions, raw) ? { mediaCondition: raw as Condition } : undefined),
  },
  sleeveCondition: {
    error: "Say the new Media condition or Sleeve condition on the Discogs scale.",
    parse: (raw) => (isOneOf(sleeveConditions, raw) ? { sleeveCondition: raw as SleeveCondition } : undefined),
  },
  note: {
    error: `A note is text of up to ${maxNoteLength} characters.`,
    parse: (raw) => {
      if (raw === null) return { note: null };
      if (typeof raw !== "string" || raw.trim().length > maxNoteLength) return undefined;
      return { note: raw.trim() || null };
    },
  },
  purchasePrice: {
    error: `A Purchase price is an amount of 0 or more with at most two decimals, in one of ${currencies.join(", ")}.`,
    parse: (raw) => {
      if (raw === null) return { purchasePrice: null, purchaseCurrency: null };
      const { amount, currency } = (typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return isCents(amount) && isCurrency(currency) ? { purchasePrice: amount, purchaseCurrency: currency } : undefined;
    },
  },
  purchaseDate: {
    error: "A purchase date is a real day written as YYYY-MM-DD, and not in the future.",
    parse: (raw, now) => (raw === null ? { purchaseDate: null } : isPurchaseDay(raw, now) ? { purchaseDate: raw } : undefined),
  },
};

/** Reads a PATCH body into the Copy columns it changes. Every named field must be valid, or nothing changes. */
export function parseCopyChanges(body: unknown, now: Date): Parsed {
  const given = Object.entries(typeof body === "object" && body !== null ? body : {}).filter(([name]) => Object.hasOwn(fields, name));
  if (given.length === 0) return { error: "Say what to change: a condition, the note, the Purchase price or the purchase date." };
  let changes: CopyChanges = {};
  for (const [name, raw] of given) {
    const field = fields[name]!;
    const parsed = field.parse(raw, now);
    if (!parsed) return { error: field.error };
    changes = { ...changes, ...parsed };
  }
  return { changes };
}

export function purchaseOf(copy: { purchasePrice: number | null; purchaseCurrency: Currency | null }): Money | null {
  return copy.purchasePrice === null || copy.purchaseCurrency === null ? null : { amount: copy.purchasePrice, currency: copy.purchaseCurrency };
}

/** The Value minus the Purchase price, in the Value's currency. None without both, or when the Purchase price can't be converted. */
export async function gainOf(value: CopyValue | undefined, purchase: Money | null, exchangeRates: ExchangeRates): Promise<number | null> {
  if (!purchase || value?.value == null) return null;
  try {
    const paid = await exchangeRates.convert(purchase, value.currency);
    return Math.round((value.value - paid.amount) * 100) / 100;
  } catch (error) {
    console.error(`Gain couldn't convert ${purchase.currency} to ${value.currency}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
