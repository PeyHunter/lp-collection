import { useState, type FormEvent } from "react";
import type { CopyView } from "../server/collection.ts";
import { maxNoteLength } from "../server/copy-details.ts";
import { currencies, type Currency } from "../server/discogs.ts";
import { parseTypedAmount, typedAmount } from "./typed-amount.ts";
import { formatAmount } from "./Value.tsx";

export type DetailChanges = Partial<{ note: string | null; purchasePrice: { amount: number; currency: Currency } | null; purchaseDate: string | null }>;

/** Saves changed details and answers the error to show, or nothing once saved. */
export type SaveDetails = (changes: DetailChanges) => Promise<string | undefined>;

type Saving = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

export function formatDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" });
}

function signed(amount: number, currency: Currency) {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${formatAmount(Math.abs(amount), currency)}`;
}

export function GainFigure({ gain, currency }: { gain: number; currency: Currency }) {
  const direction = gain > 0 ? "up" : gain < 0 ? "down" : "even";
  return (
    <p className={`gain-figure ${direction}`}>
      Gain <b className="tnum">{signed(gain, currency)}</b>
    </p>
  );
}

export function PurchaseLine({ copy }: { copy: CopyView }) {
  const { purchasePrice, purchaseDate, value, gain } = copy;
  if (!purchasePrice && !purchaseDate) return null;
  const converted = gain !== null && purchasePrice && value && purchasePrice.currency !== value.currency;
  return (
    <p className="lowest">
      {purchasePrice ? (
        <>
          Paid <b className="tnum">{formatAmount(purchasePrice.amount, purchasePrice.currency)}</b>
        </>
      ) : (
        "Bought"
      )}
      {purchaseDate && <> on {formatDay(purchaseDate)}</>}
      {converted && <>, converted at today's ECB rate</>}
    </p>
  );
}

function useSaving(save: SaveDetails) {
  const [saving, setSaving] = useState<Saving>({ kind: "idle" });
  async function run(changes: DetailChanges) {
    setSaving({ kind: "saving" });
    const error = await save(changes);
    setSaving(error ? { kind: "failed", message: error } : { kind: "saved" });
  }
  return { saving, setSaving, run };
}

function SavingNote({ saving, what }: { saving: Saving; what: string }) {
  if (saving.kind === "failed") {
    return (
      <p className="notice error" role="alert">
        {what} wasn't saved. {saving.message}
      </p>
    );
  }
  if (saving.kind !== "saved") return null;
  return (
    <p className="hint" role="status">
      {what} saved.
    </p>
  );
}

const today = () => new Date().toLocaleDateString("sv-SE");

export function PurchaseSection({ copy, userCurrency, onSave }: { copy: CopyView; userCurrency: Currency; onSave: SaveDetails }) {
  const [amount, setAmount] = useState(copy.purchasePrice ? typedAmount(copy.purchasePrice.amount) : "");
  const [currency, setCurrency] = useState<Currency>(copy.purchasePrice?.currency ?? userCurrency);
  const [date, setDate] = useState(copy.purchaseDate ?? "");
  const { saving, setSaving, run } = useSaving(onSave);
  const busy = saving.kind === "saving";
  const hasPurchase = copy.purchasePrice !== null || copy.purchaseDate !== null;

  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      if (saving.kind !== "saving") setSaving({ kind: "idle" });
    };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseTypedAmount(amount);
    if (parsed === undefined) return setSaving({ kind: "failed", message: "Type the price as a number, such as 149,95." });
    void run({ purchasePrice: parsed === null ? null : { amount: parsed, currency }, purchaseDate: date || null });
  }

  function clear() {
    setAmount("");
    setDate("");
    void run({ purchasePrice: null, purchaseDate: null });
  }

  return (
    <section className="section" aria-labelledby="purchase-heading" aria-busy={busy}>
      <div className="section-head">
        <h2 id="purchase-heading">Purchase</h2>
      </div>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="purchase-price">Purchase price</label>
          <div className="field-row">
            <input
              className="input tnum"
              id="purchase-price"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Optional"
              value={amount}
              disabled={busy}
              onChange={(event) => edited(setAmount)(event.currentTarget.value)}
            />
            <select
              className="input currency"
              aria-label="Purchase currency"
              value={currency}
              disabled={busy}
              onChange={(event) => edited(setCurrency)(event.currentTarget.value as Currency)}
            >
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="purchase-date">Purchase date</label>
          <input
            className="input"
            id="purchase-date"
            type="date"
            max={today()}
            value={date}
            disabled={busy}
            onChange={(event) => edited(setDate)(event.currentTarget.value)}
          />
        </div>
        <div className="form-actions">
          <button className="btn secondary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save purchase"}
          </button>
          {hasPurchase && (
            <button className="btn quiet" type="button" disabled={busy} onClick={clear}>
              Clear
            </button>
          )}
        </div>
      </form>
      <SavingNote saving={saving} what="The purchase" />
    </section>
  );
}

export function NoteSection({ copy, onSave }: { copy: CopyView; onSave: SaveDetails }) {
  const [note, setNote] = useState(copy.note ?? "");
  const { saving, setSaving, run } = useSaving(onSave);
  const busy = saving.kind === "saving";

  function submit(event: FormEvent) {
    event.preventDefault();
    void run({ note: note.trim() || null });
  }

  return (
    <section className="section" aria-labelledby="note-heading" aria-busy={busy}>
      <div className="section-head">
        <h2 id="note-heading">Note</h2>
      </div>
      <form className="form" onSubmit={submit}>
        <textarea
          className="input"
          aria-labelledby="note-heading"
          placeholder="Where it came from, how it plays…"
          maxLength={maxNoteLength}
          value={note}
          disabled={busy}
          onChange={(event) => {
            setNote(event.currentTarget.value);
            if (!busy) setSaving({ kind: "idle" });
          }}
        />
        <div className="form-actions">
          <button className="btn secondary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save note"}
          </button>
        </div>
      </form>
      <SavingNote saving={saving} what="The note" />
    </section>
  );
}
