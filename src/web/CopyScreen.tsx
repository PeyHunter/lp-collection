import { useEffect, useState } from "react";
import type { CopyView } from "../server/collection.ts";
import { conditions, sleeveConditions, type Condition, type SleeveCondition } from "../server/discogs.ts";
import type { Me } from "./App.tsx";
import { GainFigure, NoteSection, PurchaseLine, PurchaseSection, type DetailChanges } from "./CopyDetails.tsx";
import { Cover } from "./Cover.tsx";
import { Grade } from "./Grade.tsx";
import { Header } from "./Header.tsx";
import { navigate } from "./navigation.ts";
import { ConfirmDelete, PhotosSection } from "./Photos.tsx";
import { Amount, formatAmount, SellerSettingsGuide } from "./Value.tsx";

type Loaded = { copy: CopyView; sellerSettingsMissing: boolean };

type CopyState = { kind: "loading" } | { kind: "failed" } | { kind: "not-found" } | ({ kind: "loaded" } & Loaded);

type ConditionChange = { mediaCondition: Condition } | { sleeveCondition: SleeveCondition };

type Saving = { kind: "idle" } | { kind: "saving" } | { kind: "failed" };

/** One Copy. Each part of it is its own section; the Value comes right after the title so it shows without scrolling. */
export function CopyScreen({ me, copyId }: { me: Me; copyId: string }) {
  const [state, setState] = useState<CopyState>({ kind: "loading" });
  const [saving, setSaving] = useState<Saving>({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const copyUrl = `/api/collections/${me.collection.id}/copies/${encodeURIComponent(copyId)}`;

  useEffect(() => {
    fetch(copyUrl)
      .then(async (response) => {
        if (response.status === 404) return setState({ kind: "not-found" });
        if (!response.ok) return setState({ kind: "failed" });
        setState({ kind: "loaded", ...((await response.json()) as Loaded) });
      })
      .catch(() => setState({ kind: "failed" }));
  }, [copyUrl, attempt]);

  async function changeCondition(loaded: Loaded, change: ConditionChange) {
    setState({ kind: "loaded", ...loaded, copy: { ...loaded.copy, ...change } });
    setSaving({ kind: "saving" });
    const response = await fetch(copyUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    }).catch(() => undefined);
    if (!response?.ok) {
      setState({ kind: "loaded", ...loaded });
      return setSaving({ kind: "failed" });
    }
    setState({ kind: "loaded", ...((await response.json()) as Loaded) });
    setSaving({ kind: "idle" });
  }

  async function saveDetails(changes: DetailChanges) {
    const response = await fetch(copyUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changes),
    }).catch(() => undefined);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => undefined)) as { error?: string } | undefined;
      return body?.error ?? "Check your connection and try again.";
    }
    const { copy } = (await response.json()) as Loaded;
    setState((current) => (current.kind === "loaded" ? { ...current, copy } : current));
    return undefined;
  }

  const added = state.kind === "loaded" ? `Added ${new Date(state.copy.addedAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}` : "Copy";

  return (
    <>
      <Header kicker="Copy" title={added} back="/" />
      <main className="content-grid">
        {state.kind === "loading" && <p className="loading">Loading this Copy…</p>}
        {state.kind === "not-found" && <p className="notice error">This Copy isn't in your Collection.</p>}
        {state.kind === "failed" && (
          <div className="notice error" role="alert">
            <p>This Copy couldn't load. Check your connection and try again.</p>
            <button className="btn quiet" type="button" onClick={() => setAttempt((count) => count + 1)}>
              Try again
            </button>
          </div>
        )}
        {state.kind === "loaded" && (
          <>
            <TitleSection copy={state.copy} />
            {state.sellerSettingsMissing ? (
              <SellerSettingsGuide url={me.sellerSettingsUrl} collectionId={me.collection.id} onValued={() => setAttempt((count) => count + 1)} />
            ) : (
              <ValueSection copy={state.copy} updating={saving.kind === "saving"} />
            )}
            <ReleaseSection copy={state.copy} />
            <ConditionSection copy={state.copy} saving={saving} onChange={(change) => changeCondition(state, change)} />
            <PurchaseSection key={`purchase-${state.copy.id}`} copy={state.copy} userCurrency={me.currency} onSave={saveDetails} />
            <NoteSection key={`note-${state.copy.id}`} copy={state.copy} onSave={saveDetails} />
            <PhotosSection copy={state.copy} copyUrl={copyUrl} onChanged={(copy) => setState({ ...state, copy })} />
            <DeleteCopySection copy={state.copy} copyUrl={copyUrl} />
          </>
        )}
      </main>
    </>
  );
}

function TitleSection({ copy: { release, pictureUrl } }: { copy: CopyView }) {
  return (
    <section className="poster title-block" aria-labelledby="title-heading">
      <Cover url={pictureUrl} className="big-cover" />
      <div className="rule" />
      <h2 id="title-heading" className="poster-h">
        {release.title}
      </h2>
      <p className="by">{release.artist}</p>
    </section>
  );
}

function ReleaseSection({ copy: { release } }: { copy: CopyView }) {
  const facts = [
    ["Original year", release.originalYear],
    ["Pressing year", release.pressingYear],
    ["Label", release.label],
    ["Catalog number", release.catalogNumber],
    ["Country", release.country],
  ] as const;
  return (
    <section aria-label="Release">
      <dl className="release">
        {facts
          .filter(([, fact]) => fact !== null)
          .map(([name, fact]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd className={typeof fact === "number" ? "big tnum" : name === "Catalog number" ? "tnum" : undefined}>{fact}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

function ValueSection({ copy, updating }: { copy: CopyView; updating: boolean }) {
  const { value } = copy;
  return (
    <section className="section" aria-labelledby="value-heading" aria-busy={updating}>
      <div className="section-head">
        <h2 id="value-heading">Value</h2>
        <span className="count">
          for <Grade condition={copy.mediaCondition} />
        </span>
      </div>
      <div className="value-figure" aria-live="polite">
        {updating ? (
          <p className="loading">Fetching the Value from Discogs…</p>
        ) : value?.value != null ? (
          <>
            <p>
              <Amount amount={value.value} currency={value.currency} />
            </p>
            {copy.gain !== null && <GainFigure gain={copy.gain} currency={value.currency} />}
          </>
        ) : (
          <p className="no-value">No Value yet</p>
        )}
      </div>
      {!updating && value?.lowestListing != null && (
        <p className="lowest">
          Lowest listing <b className="tnum">{formatAmount(value.lowestListing, value.currency)}</b>, any condition
        </p>
      )}
      {!updating && value && value.value === null && (
        <p className="hint">Discogs has no suggested price for this Release in this condition yet.</p>
      )}
      {!updating && <PurchaseLine copy={copy} />}
    </section>
  );
}

function ConditionSection({ copy, saving, onChange }: { copy: CopyView; saving: Saving; onChange: (change: ConditionChange) => void }) {
  return (
    <section className="section" aria-labelledby="condition-heading">
      <div className="section-head">
        <h2 id="condition-heading">Condition</h2>
      </div>
      <div className="field">
        <label htmlFor="media-condition">Media condition</label>
        <select
          className="input"
          id="media-condition"
          value={copy.mediaCondition}
          disabled={saving.kind === "saving"}
          onChange={(event) => onChange({ mediaCondition: event.currentTarget.value as Condition })}
        >
          {conditions.map((condition) => (
            <option key={condition}>{condition}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="sleeve-condition">Sleeve condition</label>
        <select
          className="input"
          id="sleeve-condition"
          value={copy.sleeveCondition}
          disabled={saving.kind === "saving"}
          onChange={(event) => onChange({ sleeveCondition: event.currentTarget.value as SleeveCondition })}
        >
          {sleeveConditions.map((condition) => (
            <option key={condition}>{condition}</option>
          ))}
        </select>
      </div>
      {saving.kind === "failed" ? (
        <p className="notice error" role="alert">
          The condition couldn't be saved. Try again.
        </p>
      ) : (
        <p className="hint">The Value follows the Media condition and updates as soon as you change it.</p>
      )}
    </section>
  );
}

function DeleteCopySection({ copy, copyUrl }: { copy: CopyView; copyUrl: string }) {
  const [failed, setFailed] = useState(false);
  const photos = copy.photos.length;
  const question = `Delete ${copy.release.title}${photos === 0 ? "" : photos === 1 ? " and its photo" : ` and its ${photos} photos`}? This can't be undone.`;

  async function remove() {
    setFailed(false);
    const response = await fetch(copyUrl, { method: "DELETE" }).catch(() => undefined);
    if (!response?.ok) return setFailed(true);
    navigate("/", { kind: "deleted", title: copy.release.title });
  }

  return (
    <section className="section" aria-label="Delete this Copy">
      <ConfirmDelete label="Delete this Copy" question={question} confirmLabel="Delete Copy" onConfirm={remove} />
      {failed && (
        <p className="notice error" role="alert">
          The Copy wasn't deleted. Check your connection and try again.
        </p>
      )}
    </section>
  );
}
