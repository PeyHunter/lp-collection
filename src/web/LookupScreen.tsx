import { useState } from "react";
import type { CopyView, LookupCandidate, LookupView } from "../server/collection.ts";
import { Cover } from "./Cover.tsx";
import { Header } from "./Header.tsx";
import { navigate } from "./navigation.ts";
import { Scanner } from "./Scanner.tsx";

type Way = "barcode" | "catalogNumber" | "artistTitle";

type Typed = { barcode: string; catalogNumber: string; artist: string; title: string };

/** The ways to look a record up, in the order the Lookup falls back through them. */
const ways: Record<Way, { chip: string; next: Way | null; offer: string; noMatch: (searched: string) => string; tip: string }> = {
  barcode: {
    chip: "Barcode",
    next: "catalogNumber",
    offer: "Search by Catalog number",
    noMatch: (searched) => `No Release on Discogs has the barcode ${searched}.`,
    tip: "Check the digits against the sleeve. Some older records have no barcode at all, but the Catalog number on the spine or the label finds them.",
  },
  catalogNumber: {
    chip: "Catalog number",
    next: "artistTitle",
    offer: "Search by artist and title",
    noMatch: (searched) => `No Release on Discogs has the Catalog number ${searched}.`,
    tip: "Check it against the spine and the label. Some labels print it in more than one way.",
  },
  artistTitle: {
    chip: "Artist and title",
    next: null,
    offer: "",
    noMatch: (searched) => `Nothing on Discogs matches ${searched}.`,
    tip: "Check the spelling, or type less: only the artist, or a few words of the title.",
  },
};

type Save = { kind: "ready" } | { kind: "saving" } | { kind: "failed"; message: string };

type Found = { kind: "found"; way: Way; searched: string; total: number; candidates: LookupCandidate[]; chosen: number | null; save: Save };

type Lookup = { kind: "idle" } | { kind: "looking" } | { kind: "failed"; message: string } | Found;

const unreachable = "LP-Collection can't reach its server right now. Try again in a moment.";

async function errorMessage(response: Response) {
  const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  return body?.error ?? unreachable;
}

function queryFor(way: Way, typed: Typed): Record<string, string> {
  if (way === "barcode") return { barcode: typed.barcode };
  if (way === "catalogNumber") return { catalogNumber: typed.catalogNumber };
  return { artist: typed.artist, title: typed.title };
}

function searchedText(view: LookupView) {
  if ("barcode" in view) return view.barcode;
  if ("catalogNumber" in view) return view.catalogNumber;
  return [view.artist, view.title].filter(Boolean).join(" · ");
}

export function LookupScreen({ collectionId }: { collectionId: string }) {
  const [way, setWay] = useState<Way>("barcode");
  const [wayChosen, setWayChosen] = useState(false);
  const [typed, setTyped] = useState<Typed>({ barcode: "", catalogNumber: "", artist: "", title: "" });
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });

  function type(field: keyof Typed, value: string) {
    setTyped((current) => ({ ...current, [field]: value }));
  }

  function switchTo(next: Way) {
    setWay(next);
    setWayChosen(true);
    setLookup({ kind: "idle" });
  }

  async function lookUp(lookupWay: Way, query: Record<string, string>) {
    setLookup({ kind: "looking" });
    const response = await fetch(`/api/collections/${collectionId}/lookup?${new URLSearchParams(query)}`).catch(() => undefined);
    if (!response) return setLookup({ kind: "failed", message: unreachable });
    if (!response.ok) return setLookup({ kind: "failed", message: await errorMessage(response) });
    const view = (await response.json()) as LookupView;
    const only = view.candidates.length === 1 ? view.candidates[0]!.discogsReleaseId : null;
    setLookup({ kind: "found", way: lookupWay, searched: searchedText(view), total: view.total, candidates: view.candidates, chosen: only, save: { kind: "ready" } });
  }

  async function save(found: Found, candidate: LookupCandidate) {
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
    navigate("/", { kind: "saved", copyId: copy.id, title: copy.release.title });
  }

  const looking = lookup.kind === "looking";

  return (
    <>
      <Header kicker="Lookup" title="Add a record" back="/" />
      <main className="content-grid">
        <Scanner
          onRead={(barcode) => {
            setWay("barcode");
            setWayChosen(false);
            type("barcode", barcode);
            void lookUp("barcode", { barcode });
          }}
        />
        <form
          className="section"
          onSubmit={(event) => {
            event.preventDefault();
            void lookUp(way, queryFor(way, typed));
          }}
          aria-labelledby="type-heading"
        >
          <div className="section-head">
            <h2 id="type-heading">Type it in</h2>
          </div>
          <fieldset className="chips">
            <legend className="visually-hidden">Look up by</legend>
            {(Object.keys(ways) as Way[]).map((option) => (
              <label className="chip" key={option}>
                <input type="radio" name="way" value={option} checked={way === option} onChange={() => switchTo(option)} />
                {ways[option].chip}
              </label>
            ))}
          </fieldset>
          {way === "barcode" && (
            <div className="field">
              <label htmlFor="barcode">Barcode</label>
              <div className="field-row">
                <input
                  className="input tnum"
                  id="barcode"
                  value={typed.barcode}
                  onChange={(event) => type("barcode", event.target.value)}
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="search"
                  autoFocus={wayChosen}
                  required
                />
                <LookUpButton looking={looking} />
              </div>
              <p className="hint">The 12 or 13 digits under the bars, usually on the back of the sleeve.</p>
            </div>
          )}
          {way === "catalogNumber" && (
            <div className="field">
              <label htmlFor="catalog-number">Catalog number</label>
              <div className="field-row">
                <input
                  className="input tnum"
                  id="catalog-number"
                  value={typed.catalogNumber}
                  onChange={(event) => type("catalogNumber", event.target.value)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  maxLength={100}
                  autoFocus={wayChosen}
                  required
                />
                <LookUpButton looking={looking} />
              </div>
              <p className="hint">The label's code for the record, on the spine or the label, such as PCS 7027.</p>
            </div>
          )}
          {way === "artistTitle" && (
            <div className="field-stack">
              <div className="field">
                <label htmlFor="artist">Artist</label>
                <input
                  className="input"
                  id="artist"
                  value={typed.artist}
                  onChange={(event) => type("artist", event.target.value)}
                  autoComplete="off"
                  enterKeyHint="search"
                  maxLength={100}
                  autoFocus={wayChosen}
                />
              </div>
              <div className="field">
                <label htmlFor="title">Title</label>
                <input
                  className="input"
                  id="title"
                  value={typed.title}
                  onChange={(event) => type("title", event.target.value)}
                  autoComplete="off"
                  enterKeyHint="search"
                  maxLength={100}
                />
              </div>
              <p className="hint">Fill in one or both.</p>
              <LookUpButton looking={looking} />
            </div>
          )}
        </form>

        <section className="section" aria-label="Matches" aria-busy={looking}>
          {looking && <p className="loading">Asking Discogs…</p>}
          {lookup.kind === "failed" && (
            <p className="notice error" role="alert">
              {lookup.message}
            </p>
          )}
          {lookup.kind === "found" && (
            <Matches
              found={lookup}
              onChoose={(chosen) => setLookup({ ...lookup, chosen, save: { kind: "ready" } })}
              onSave={(candidate) => save(lookup, candidate)}
              onNextWay={switchTo}
            />
          )}
        </section>
      </main>
    </>
  );
}

function LookUpButton({ looking }: { looking: boolean }) {
  return (
    <button className="btn primary" type="submit" disabled={looking}>
      {looking ? "Looking…" : "Look up"}
    </button>
  );
}

function copiesText(count: number) {
  return count === 1 ? "1 Copy" : `${count} Copies`;
}

function Matches({
  found,
  onChoose,
  onSave,
  onNextWay,
}: {
  found: Found;
  onChoose: (discogsReleaseId: number | null) => void;
  onSave: (candidate: LookupCandidate) => void;
  onNextWay: (way: Way) => void;
}) {
  const { way, searched, total, candidates, chosen, save } = found;
  const { next } = ways[way];
  const nextWay = next && (
    <button className="link" type="button" onClick={() => onNextWay(next)}>
      {ways[way].offer}
    </button>
  );
  if (candidates.length === 0) {
    return (
      <div className="empty" role="status">
        <p>{ways[way].noMatch(searched)}</p>
        <p className="hint">{ways[way].tip}</p>
        {next && (
          <button className="btn primary" type="button" onClick={() => onNextWay(next)}>
            {ways[way].offer}
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="section-head">
        <h2>{total === 1 ? "1 Release matches" : `${total.toLocaleString("da-DK")} Releases match`}</h2>
        <span className="count tnum">{searched}</span>
      </div>
      {total > candidates.length ? (
        <p className="lead">
          Showing the first {candidates.length}. Type more of the artist or the title to find yours faster.
        </p>
      ) : (
        candidates.length > 1 && <p className="lead">Tap the pressing you hold. Check the label and the year on the sleeve.</p>
      )}
      <ol className="rows">
        {candidates.map((candidate) => {
          const isChosen = candidate.discogsReleaseId === chosen;
          const panelId = `save-${candidate.discogsReleaseId}`;
          const facts = [candidate.pressingYear, candidate.country, candidate.label, candidate.catalogNumber, candidate.format].filter((fact) => fact !== null);
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
                  {candidate.copiesInCollection > 0 && <span className="badge">In your Collection</span>}
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
                <div className={candidate.copiesInCollection > 0 ? "save-panel duplicate" : "save-panel"} id={panelId}>
                  {candidate.copiesInCollection > 0 ? (
                    <p className="warning" role="alert">You already have {copiesText(candidate.copiesInCollection)} of this. Add another?</p>
                  ) : (
                    <p>Will be saved with Media condition and Sleeve condition Very Good Plus.</p>
                  )}
                  {save.kind === "failed" && (
                    <p className="notice error" role="alert">
                      {save.message}
                    </p>
                  )}
                  {candidate.copiesInCollection > 0 ? (
                    <div className="actions">
                      <button className="btn primary" type="button" onClick={() => onSave(candidate)} disabled={save.kind === "saving"}>
                        {save.kind === "saving" ? "Adding…" : "Add another"}
                      </button>
                      <button className="btn secondary" type="button" onClick={() => onChoose(null)} disabled={save.kind === "saving"}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button className="btn primary" type="button" onClick={() => onSave(candidate)} disabled={save.kind === "saving"}>
                      {save.kind === "saving" ? "Adding…" : "Add to Collection"}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {nextWay && <p className="next-way">Not the one you hold? {nextWay}</p>}
    </>
  );
}
