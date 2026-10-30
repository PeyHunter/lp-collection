import { useState } from "react";
import type { CopyView } from "../server/collection.ts";
import type { Currency } from "../server/discogs.ts";

const units: Partial<Record<Currency, string>> = { DKK: "kr", SEK: "kr", NOK: "kr", EUR: "€", GBP: "£", USD: "$" };
const wholeNumber = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 });

export function formatAmount(amount: number, currency: Currency) {
  return `${wholeNumber.format(amount)} ${units[currency] ?? currency}`;
}

export function Amount({ amount, currency, className = "amount" }: { amount: number; currency: Currency; className?: string }) {
  return (
    <span className={`${className} tnum`}>
      {wholeNumber.format(amount)} <small>{units[currency] ?? currency}</small>
    </span>
  );
}

export function RowValue({ value, sellerSettingsMissing, fetching }: { value: CopyView["value"]; sellerSettingsMissing: boolean; fetching: boolean }) {
  if (value?.value != null) return <Amount amount={value.value} currency={value.currency} className="row-end row-value" />;
  if (sellerSettingsMissing) return <span className="row-end waiting">Waits for seller settings</span>;
  if (!value && fetching) return <span className="row-end waiting">Fetching Value…</span>;
  return <span className="row-end no-value">No Value yet</span>;
}

export type ValuesAnswer = { copies: CopyView[]; sellerSettingsMissing: boolean; more: boolean; retryEmptyBefore?: string };

/** Asks for missing Values a batch at a time until none are left, Discogs stops answering, or the caller aborts. Undefined when a request failed. */
export async function fetchValues(
  collectionId: string,
  { retryEmpty = false, signal, onBatch }: { retryEmpty?: boolean; signal?: AbortSignal; onBatch?: (answer: ValuesAnswer) => void } = {},
): Promise<ValuesAnswer | undefined> {
  let body: object = retryEmpty ? { retryEmpty: true } : {};
  for (;;) {
    const response = await fetch(`/api/collections/${collectionId}/values`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).catch(() => undefined);
    if (!response?.ok) return undefined;
    const answer = (await response.json()) as ValuesAnswer;
    onBatch?.(answer);
    if (!answer.more || answer.sellerSettingsMissing) return answer;
    body = answer.retryEmptyBefore ? { retryEmptyBefore: answer.retryEmptyBefore } : {};
  }
}

type GuideState = { kind: "idle" } | { kind: "checking" } | { kind: "still-missing" } | { kind: "failed" };

export function SellerSettingsGuide({ url, collectionId, onValued }: { url: string; collectionId: string; onValued: () => void }) {
  const [state, setState] = useState<GuideState>({ kind: "idle" });

  async function check() {
    setState({ kind: "checking" });
    const answer = await fetchValues(collectionId, { retryEmpty: true });
    if (!answer) return setState({ kind: "failed" });
    if (answer.sellerSettingsMissing) return setState({ kind: "still-missing" });
    onValued();
  }

  return (
    <section className="guide" aria-labelledby="seller-settings-heading">
      <h2 id="seller-settings-heading">Fill in your Discogs seller settings to see Values</h2>
      <p>
        Discogs suggests prices only to accounts whose seller settings are filled in. You don't have to sell anything. Open the settings, fill in
        your country and currency, and save.
      </p>
      <ol className="steps">
        <li>
          <a className="btn primary" href={url} target="_blank" rel="noreferrer">
            Open seller settings on Discogs
          </a>
        </li>
        <li>
          <button className="btn secondary" type="button" onClick={check} disabled={state.kind === "checking"}>
            {state.kind === "checking" ? "Fetching Values…" : "I've saved them, fetch Values"}
          </button>
        </li>
      </ol>
      {state.kind === "still-missing" && (
        <p className="hint" role="alert">
          Discogs still says your seller settings are missing. Save them on Discogs, then try again.
        </p>
      )}
      {state.kind === "failed" && (
        <p className="hint" role="alert">
          Discogs didn't answer. Try again in a moment.
        </p>
      )}
    </section>
  );
}
