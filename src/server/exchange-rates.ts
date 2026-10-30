import { currencies, type Currency, type Money } from "./discogs.ts";

export type ExchangeRates = {
  convert(money: Money, to: Currency): Promise<Money>;
};

type PerEuro = Record<Currency, number>;

export function converter(perEuro: PerEuro) {
  return (money: Money, to: Currency): Money => {
    if (money.currency === to) return money;
    const amount = (money.amount / perEuro[money.currency]) * perEuro[to];
    return { amount: Math.round(amount * 100) / 100, currency: to };
  };
}

export const sampleRatesPerEuro: PerEuro = {
  EUR: 1,
  DKK: 7.46,
  SEK: 11.2,
  NOK: 11.6,
  GBP: 0.85,
  USD: 1.1,
  CHF: 0.94,
  CAD: 1.52,
  AUD: 1.68,
  NZD: 1.86,
  JPY: 165,
  MXN: 20.5,
  BRL: 6.1,
  ZAR: 20,
};

export function createFixedRates(perEuro: PerEuro = sampleRatesPerEuro): ExchangeRates {
  const convert = converter(perEuro);
  return { convert: async (money, to) => convert(money, to) };
}

const ecbDailyUrl = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const refreshAfterMs = 12 * 60 * 60 * 1000;

/** The European Central Bank's daily reference rates, fetched at most twice a day. */
export function createEcbRates({ url = ecbDailyUrl, now = () => Date.now() }: { url?: string; now?: () => number } = {}): ExchangeRates {
  let cached: { perEuro: PerEuro; fetchedAt: number } | undefined;

  async function perEuro() {
    if (cached && now() - cached.fetchedAt < refreshAfterMs) return cached.perEuro;
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`The ECB answered its daily rates with HTTP ${response.status}`);
    cached = { perEuro: parseEcbRates(await response.text()), fetchedAt: now() };
    return cached.perEuro;
  }

  return {
    async convert(money, to) {
      if (money.currency === to) return money;
      return converter(await perEuro())(money, to);
    },
  };
}

export function parseEcbRates(xml: string): PerEuro {
  const found = new Map<string, number>([["EUR", 1]]);
  for (const [, code, rate] of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    found.set(code!, Number(rate));
  }
  const missing = currencies.filter((code) => !(found.get(code)! > 0));
  if (missing.length > 0) throw new Error(`The ECB daily rates have no rate for ${missing.join(", ")}`);
  return Object.fromEntries(currencies.map((code) => [code, found.get(code)!])) as PerEuro;
}
