import { useState } from "react";
import type { CopyView, CopyWithValues } from "../server/collection.ts";
import type { Currency } from "../server/discogs.ts";

const units: Partial<Record<Currency, string>> = { DKK: "kr", SEK: "kr", NOK: "kr", EUR: "€", GBP: "£", USD: "$" };
const wholeNumber = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 });

export function currencyUnit(currency: Currency) {
  return units[currency] ?? currency;
}

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

/** The API leaves every Value field out of a Copy while the User hides Values. */
export function hasValues(copy: CopyView): copy is CopyWithValues {
  return "value" in copy;
}

/** Without Discogs seller settings, the Value is the Lowest listing instead of the suggested price for the Media condition. */
export function isLowestListing(value: CopyWithValues["value"]) {
  return value?.value != null && value.value === value.lowestListing;
}

export function RowValue({ value, fetching }: { value: CopyWithValues["value"]; fetching: boolean }) {
  if (value?.value != null && isLowestListing(value)) {
    return (
      <span className="row-end">
        <Amount amount={value.value} currency={value.currency} className="row-value" />
        <span className="waiting row-value-note">Lowest price</span>
      </span>
    );
  }
  if (value?.value != null) return <Amount amount={value.value} currency={value.currency} className="row-end row-value" />;
  if (!value && fetching) return <span className="row-end waiting">Fetching Value…</span>;
  return <span className="row-end no-value">No Value yet</span>;
}

export type ValuesAnswer = { copies?: CopyView[]; sellerSettingsMissing?: boolean; more: boolean; retryEmptyBefore?: string };

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
    if (!answer.more) return answer;
    body = answer.retryEmptyBefore ? { retryEmptyBefore: answer.retryEmptyBefore } : {};
  }
}

type SwitchState = { kind: "idle" } | { kind: "saving" } | { kind: "failed" };

export function ValuesSwitch({ showValues, onChanged }: { showValues: boolean; onChanged: (showValues: boolean) => void }) {
  const [state, setState] = useState<SwitchState>({ kind: "idle" });

  async function toggle() {
    setState({ kind: "saving" });
    const response = await fetch("/api/me/show-values", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ showValues: !showValues }),
    }).catch(() => undefined);
    if (!response?.ok) return setState({ kind: "failed" });
    setState({ kind: "idle" });
    onChanged(!showValues);
  }

  return (
    <button
      className="values-switch"
      type="button"
      role="switch"
      aria-checked={showValues}
      aria-describedby={state.kind === "failed" ? "values-switch-failed" : undefined}
      disabled={state.kind === "saving"}
      onClick={toggle}
    >
      Values
      <span className="track" aria-hidden="true" />
      {state.kind === "failed" && (
        <span className="visually-hidden" id="values-switch-failed" role="alert">
          The switch couldn't be saved. Try again.
        </span>
      )}
    </button>
  );
}

export function SellerSettingsHint({ url }: { url: string }) {
  return (
    <p className="hint seller-settings-hint">
      For now, Values are the lowest price on Discogs. Fill in your{" "}
      <a href={url} target="_blank" rel="noreferrer">
        Discogs seller settings
      </a>{" "}
      (country and currency, about a minute) to get the realistic price for each condition.
    </p>
  );
}

export type HistoryPoint = { recordedAt: string; value: number | null };

const monthName = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

export function historyMonth(recordedAt: string) {
  return monthName.format(new Date(recordedAt));
}

/** A line through the recorded Values, oldest on the left. Months with no Value leave a gap in the line. */
export function HistoryChart({ points, currency, label }: { points: HistoryPoint[]; currency: Currency; label: string }) {
  const valued = points.flatMap((point, index) => (point.value === null ? [] : [{ index, value: point.value }]));
  if (valued.length < 2) return null;
  const values = valued.map((point) => point.value);
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const x = (index: number) => (index / (points.length - 1)) * 100;
  const y = (value: number) => 36 - ((value - low) / span) * 32;
  const runs: { index: number; value: number }[][] = [];
  for (const point of valued) {
    const run = runs.at(-1);
    if (run && run.at(-1)!.index === point.index - 1) run.push(point);
    else runs.push([point]);
  }
  const first = valued[0]!;
  const last = valued.at(-1)!;
  return (
    <svg
      className="history-chart"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}: ${formatAmount(first.value, currency)} in ${historyMonth(points[first.index]!.recordedAt)}, ${formatAmount(last.value, currency)} in ${historyMonth(points[last.index]!.recordedAt)}`}
    >
      {runs.map((run) => (
        <polyline key={run[0]!.index} points={run.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
