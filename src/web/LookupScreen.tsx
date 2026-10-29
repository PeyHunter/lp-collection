import { useState, type FormEvent } from "react";
import type { CopyView } from "../server/collection.ts";
import type { ReleaseCandidate } from "../server/discogs.ts";
import { Cover } from "./Cover.tsx";
import { Header } from "./Header.tsx";
import { navigate } from "./navigation.ts";

type Save = { kind: "ready" } | { kind: "saving" } | { kind: "failed"; message: string };

type Lookup =
  | { kind: "idle" }
  | { kind: "looking" }
  | { kind: "failed"; message: string }
  | { kind: "found"; barcode: string; candidates: ReleaseCandidate[]; chosen: number | null; save: Save };

const unreachable = "LP-Collection can't reach its server right now. Try again in a moment.";

async function errorMessage(response: Response) {
  const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  return body?.error ?? unreachable;
}

export function LookupScreen({ collectionId }: { collectionId: string }) {
  const [typed, setTyped] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });

  async function lookUp(event: FormEvent) {
    event.preventDefault();
    setLookup({ kind: "looking" });
    const response = await fetch(`/api/collections/${collectionId}/lookup?barcode=${encodeURIComponent(typed)}`).catch(() => undefined);
    if (!response) return setLookup({ kind: "failed", message: unreachable });
    if (!response.ok) return setLookup({ kind: "failed", message: await errorMessage(response) });
    const { barcode, candidates } = (await response.json()) as { barcode: string; candidates: ReleaseCandidate[] };
    const only = candidates.length === 1 ? candidates[0]!.discogsReleaseId : null;
    setLookup({ kind: "found", barcode, candidates, chosen: only, save: { kind: "ready" } });
  }

  async function save(found: Extract<Lookup, { kind: "found" }>, candidate: ReleaseCandidate) {
    setLookup({ ...found, save: { kind: "saving" } });
    const response = await fetch(`/api/collections/${collectionId}/copies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discogsReleaseId: candidate.discogsReleaseId }),
    }).catch(() => undefined);
    if (!response?.ok) {
      return setLookup({ ...found, save: { kind: "failed", message: response ? await errorMessage(response) : unreachable } });
    }
    const { copy } = (await response.json()) as { copy: CopyView };
    navigate("/", { savedCopyId: copy.id, title: copy.release.title });
  }

  return (
    <>
      <Header kicker="Lookup" title="Add a record" back="/" />
      <main className="content-grid">
        <form className="section" onSubmit={lookUp} aria-labelledby="type-heading">
          <div className="section-head">
            <h2 id="type-heading">Type the barcode</h2>
          </div>
          <div className="field">
            <label htmlFor="barcode">Barcode</label>
            <div className="field-row">
              <input
                className="input tnum"
                id="barcode"
                name="barcode"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="search"
                required
              />
              <button className="btn primary" type="submit" disabled={lookup.kind === "looking"}>
                {lookup.kind === "looking" ? "Looking…" : "Look up"}
              </button>
            </div>
          </div>
          <p className="hint">The 12 or 13 digits under the bars, usually on the back of the sleeve.</p>
        </form>

        <section className="section" aria-label="Matches" aria-busy={lookup.kind === "looking"}>
          {lookup.kind === "looking" && <p className="loading">Asking Discogs…</p>}
          {lookup.kind === "failed" && (
            <p className="notice error" role="alert">
              {lookup.message}
            </p>
          )}
          {lookup.kind === "found" && <Matches found={lookup} onChoose={(chosen) => setLookup({ ...lookup, chosen, save: { kind: "ready" } })} onSave={(candidate) => save(lookup, candidate)} />}
        </section>
      </main>
    </>
  );
}

function Matches({
  found,
  onChoose,
  onSave,
}: {
  found: Extract<Lookup, { kind: "found" }>;
  onChoose: (discogsReleaseId: number) => void;
  onSave: (candidate: ReleaseCandidate) => void;
}) {
  const { barcode, candidates, chosen, save } = found;
  if (candidates.length === 0) {
    return (
      <div className="empty" role="status">
        <p>
          No Release on Discogs has the barcode <span className="tnum">{barcode}</span>.
        </p>
        <p className="hint">Check the digits against the sleeve. Some older records have no barcode at all.</p>
      </div>
    );
  }
  return (
    <>
      <div className="section-head">
        <h2>{candidates.length === 1 ? "1 Release matches" : `${candidates.length} Releases match`}</h2>
        <span className="count tnum">{barcode}</span>
      </div>
      {candidates.length > 1 && <p className="lead">Tap the pressing you hold. Check the label and the year on the sleeve.</p>}
      <ol className="rows">
        {candidates.map((candidate) => {
          const isChosen = candidate.discogsReleaseId === chosen;
          const panelId = `save-${candidate.discogsReleaseId}`;
          const facts = [candidate.year, candidate.country, candidate.label, candidate.catalogNumber, candidate.format].filter((fact) => fact !== null);
          return (
            <li className="candidate" key={candidate.discogsReleaseId} aria-current={isChosen ? "true" : undefined}>
              <div className="row">
                <Cover url={candidate.coverImageUrl} />
                <span className="row-text">
                  <button className="row-link row-title" type="button" onClick={() => onChoose(candidate.discogsReleaseId)} aria-expanded={isChosen} aria-controls={panelId}>
                    {candidate.title}
                  </button>
                  <span className="row-artist">{candidate.artist}</span>
                  <span className="row-meta">{facts.join(" · ")}</span>
                </span>
                <svg className="pick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {isChosen ? (
                    <>
                      <circle cx="12" cy="12" r="9" />
                      <path d="m8 12 3 3 5-6" />
                    </>
                  ) : (
                    <path d="m9 6 6 6-6 6" />
                  )}
                </svg>
              </div>
              {isChosen && (
                <div className="save-panel" id={panelId}>
                  <p>Saved with Media condition and Sleeve condition Very Good Plus.</p>
                  {save.kind === "failed" && (
                    <p className="notice error" role="alert">
                      {save.message}
                    </p>
                  )}
                  <button className="btn primary" type="button" onClick={() => onSave(candidate)} disabled={save.kind === "saving"}>
                    {save.kind === "saving" ? "Adding…" : "Add to Collection"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
