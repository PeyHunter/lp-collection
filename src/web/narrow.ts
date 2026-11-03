import type { LookupCandidate } from "../server/collection.ts";

export type Trait = "country" | "pressingYear" | "label" | "catalogNumber" | "formats";
export type Picks = Partial<Record<Trait, string>>;
export type Difference = { trait: Trait; options: { value: string; count: number }[] };

export const traits: Trait[] = ["country", "pressingYear", "label", "catalogNumber", "formats"];

export const notListed = "Not listed";

/** What a candidate says for a trait. Formats is the only trait with several values at once. */
export function valuesOf(candidate: LookupCandidate, trait: Trait): string[] {
  if (trait === "formats") return candidate.formats;
  const value = candidate[trait];
  return [value === null ? notListed : String(value)];
}

function matches(candidate: LookupCandidate, picks: Picks, except?: Trait) {
  return traits.every((trait) => trait === except || picks[trait] === undefined || valuesOf(candidate, trait).includes(picks[trait]!));
}

function counts(candidates: LookupCandidate[], trait: Trait) {
  const counted = new Map<string, number>();
  for (const candidate of candidates) {
    for (const value of new Set(valuesOf(candidate, trait))) counted.set(value, (counted.get(value) ?? 0) + 1);
  }
  return counted;
}

/** Which candidates still fit the picked details, and which details tell the rest apart. */
export function narrow(candidates: LookupCandidate[], picks: Picks) {
  const shown = candidates.filter((candidate) => matches(candidate, picks));
  const differences: Difference[] = [];
  const shared: { trait: Trait; value: string }[] = [];
  for (const trait of traits) {
    const pool = candidates.filter((candidate) => matches(candidate, picks, trait));
    const counted = counts(pool, trait);
    const options = [...counted]
      .filter(([value, count]) => (trait === "formats" ? count < pool.length : counted.size > 1) || value === picks[trait])
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    const differs = trait === "formats" || picks[trait] !== undefined ? options.length > 0 : options.length > 1;
    if (differs) differences.push({ trait, options });

    const inShown = counts(shown, trait);
    const inAll = [...inShown].filter(([value, count]) => count === shown.length && value !== notListed).map(([value]) => value);
    if (shown.length > 0 && inAll.length > 0 && (trait === "formats" || inShown.size === 1)) shared.push({ trait, value: inAll.join(", ") });
  }
  return { shown, differences, shared };
}
