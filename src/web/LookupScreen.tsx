import { useEffect, useRef, useState } from "react";
import type { CopyView, LookupCandidate, LookupView } from "../server/collection.ts";
import { Cover } from "./Cover.tsx";
import { BestMatch, CoverPhotoButton, lookUpCover, unreadCover } from "./CoverPhoto.tsx";
import { Header } from "./Header.tsx";
import { navigate } from "./navigation.ts";
import { Scanner } from "./Scanner.tsx";
import { narrow, notListed, valuesOf, type Difference, type Picks, type Trait } from "./narrow.ts";
import { locationLabel } from "./shelf-grid.ts";

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

/** How each detail is named, and where on the record the Owner can find it. */
const traitNames: Record<Trait, { label: string; where: string }> = {
  country: { label: "Country", where: "Made in … on the back" },
  pressingYear: { label: "Year", where: "On the label or back of the sleeve" },
  label: { label: "Label", where: "On the label or back of the sleeve" },
  catalogNumber: { label: "Catalog number", where: "On the spine" },
  formats: { label: "Edition", where: "On a sticker, the sleeve or the vinyl itself" },
};

type Save = { kind: "ready" } | { kind: "saving" } | { kind: "failed"; message: string };

type Found = { kind: "found"; way: Way; fromCover: boolean; searched: string; total: number; candidates: LookupCandidate[]; picks: Picks; chosen: number | null; save: Save };

type Lookup = { kind: "idle" } | { kind: "reading-cover" } | { kind: "looking" } | { kind: "failed"; message: string } | Found;

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

export function LookupScreen({ collectionId, coverReading }: { collectionId: string; coverReading: boolean }) {
  const [way, setWay] = useState<Way>("barcode");
  const [wayChosen, setWayChosen] = useState(false);
  const [typed, setTyped] = useState<Typed>({ barcode: "", catalogNumber: "", artist: "", title: "" });
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const matchesRef = useRef<HTMLElement>(null);
  const scrollToMatches = useRef(false);

  useEffect(() => {
    if (!scrollToMatches.current || lookup.kind === "looking") return;
    scrollToMatches.current = false;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    matchesRef.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [lookup]);

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
    show(lookupWay, (await response.json()) as LookupView, false);
  }

  function show(lookupWay: Way, view: LookupView, fromCover: boolean) {
    // A best match is added with its own button, so nothing in the list starts open.
    const only = !fromCover && view.candidates.length === 1 ? view.candidates[0]!.discogsReleaseId : null;
    setLookup({ kind: "found", way: lookupWay, fromCover, searched: searchedText(view), total: view.total, candidates: view.candidates, picks: {}, chosen: only, save: { kind: "ready" } });
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

  async function readCover(file: File) {
    setLookup({ kind: "reading-cover" });
    const found = await lookUpCover(collectionId, file);
    if (found.kind === "failed") return setLookup({ kind: "failed", message: found.message });
    // The reading is filled in as an artist and title search, so a wrong word is one edit away.
    setWay("artistTitle");
    setWayChosen(false);
    setTyped((current) => ({ ...current, artist: found.reading.artist, title: found.reading.title }));
    if (found.kind === "unread") return setLookup({ kind: "failed", message: unreadCover });
    show("artistTitle", found.view, true);
  }

  function pick(found: Found, picks: Picks) {
    const { shown } = narrow(found.candidates, picks);
    const stillShown = shown.some((candidate) => candidate.discogsReleaseId === found.chosen) ? found.chosen : null;
    const chosen = shown.length === 1 ? shown[0]!.discogsReleaseId : stillShown;
    setLookup({ ...found, picks, chosen, save: { kind: "ready" } });
  }

  const looking = lookup.kind === "looking" || lookup.kind === "reading-cover";

  const matches = (
    <section className="section matches" aria-label="Matches" aria-busy={looking} ref={matchesRef}>
      {lookup.kind === "reading-cover" && <p className="loading">Reading the cover…</p>}
      {lookup.kind === "looking" && <p className="loading">Asking Discogs…</p>}
      {lookup.kind === "failed" && (
        <p className="notice error" role="alert">
          {lookup.message}
        </p>
      )}
      {lookup.kind === "found" && (
        <Matches
          found={lookup}
          onChoose={(chosen) => setLookup({ ...lookup, chosen, save: { kind: "ready" } })}
          onPick={(picks) => pick(lookup, picks)}
          onSave={(candidate) => save(lookup, candidate)}
          onNextWay={switchTo}
        />
      )}
    </section>
  );

  return (
    <>
      <Header kicker="Lookup" title="Add a record" back="/" />
      <main className="content-grid">
        {coverReading && (
          <section className="section">
            <CoverPhotoButton busy={looking} reading={lookup.kind === "reading-cover"} onFile={(file) => void readCover(file)} />
            <p className="hint">Photograph the front of the sleeve. The best match comes up with one button to add it.</p>
          </section>
        )}
        {coverReading && matches}
        <Scanner
          onRead={(barcode) => {
            setWay("barcode");
            setWayChosen(false);
            type("barcode", barcode);
            scrollToMatches.current = true;
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

        {!coverReading && matches}
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

function whereHeld(held: LookupCandidate["held"]) {
  const places = held.map(({ location }) => (location ? locationLabel(location) : "Not on a shelf"));
  return `${held.length === 1 ? "Yours is" : "Yours are"}: ${places.join(", ")}.`;
}

function copiesText(count: number) {
  return count === 1 ? "1 Copy" : `${count} Copies`;
}

function Matches({
  found,
  onChoose,
  onSave,
  onPick,
  onNextWay,
}: {
  found: Found;
  onChoose: (discogsReleaseId: number | null) => void;
  onPick: (picks: Picks) => void;
  onSave: (candidate: LookupCandidate) => void;
  onNextWay: (way: Way) => void;
}) {
  const { way, fromCover, searched, total, candidates, picks, chosen, save } = found;
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
  if (fromCover) {
    const [best, ...others] = candidates;
    return (
      <>
        <BestMatch candidate={best!}>
          {best!.copiesInCollection > 0 && (
            <p className="warning" role="alert">
              You already have {copiesText(best!.copiesInCollection)} of this. {whereHeld(best!.held)}
            </p>
          )}
          {save.kind === "failed" && chosen === null && (
            <p className="notice error" role="alert">
              {save.message}
            </p>
          )}
          <button className="btn primary" type="button" onClick={() => onSave(best!)} disabled={save.kind === "saving"}>
            {save.kind === "saving" && chosen === null ? "Adding…" : best!.copiesInCollection > 0 ? "Add another" : "Add to my collection"}
          </button>
        </BestMatch>
        {others.length > 0 && (
          <>
            <div className="section-head">
              <h2>Not this one?</h2>
              <span className="count tnum searched">{searched}</span>
            </div>
            <CandidateList candidates={others} differences={narrow(others, {}).differences} picks={{}} chosen={chosen} save={save} onChoose={onChoose} onSave={onSave} />
          </>
        )}
        <p className="next-way">Not here at all? Change the artist or title above and look up again.</p>
      </>
    );
  }
  if (candidates.length === 1) {
    return (
      <>
        <div className="section-head">
          <h2>1 Release matches</h2>
          <span className="count tnum searched">{searched}</span>
        </div>
        <CandidateList candidates={candidates} differences={[]} picks={{}} chosen={chosen} save={save} onChoose={onChoose} onSave={onSave} />
        {nextWay && <p className="next-way">Not the one you hold? {nextWay}</p>}
      </>
    );
  }
  const { shown, differences, shared } = narrow(candidates, picks);
  const picked = Object.keys(picks).length > 0;
  return (
    <>
      <div className="section-head">
        <h2>Which one is yours?</h2>
        <span className="count tnum searched">{searched}</span>
      </div>
      <p className="lead">
        {total > candidates.length
          ? `${total.toLocaleString("da-DK")} Releases match. Showing the first ${candidates.length}. Type more of the artist or the title to find yours faster.`
          : `${candidates.length} Releases match.`}
      </p>
      {differences.length > 0 && (
        <div className="narrow" role="group" aria-labelledby="narrow-heading">
          <div className="narrow-head">
            <h3 id="narrow-heading">Narrow it down</h3>
            {picked && (
              <button className="link" type="button" onClick={() => onPick({})}>
                Show all {candidates.length}
              </button>
            )}
          </div>
          {differences.map((difference) => (
            <NarrowRow key={difference.trait} difference={difference} picked={picks[difference.trait]} onPick={(value) => onPick(withPick(picks, difference.trait, value))} />
          ))}
        </div>
      )}
      {shown.length > 1 && shared.length > 0 && (
        <p className="shared">
          All {shown.length} share: {shared.map(({ value }) => value).join(" · ")}
        </p>
      )}
      {/* The last one left shows every detail, so it can be checked against the sleeve. */}
      <CandidateList candidates={shown} differences={shown.length > 1 ? differences : []} picks={picks} chosen={chosen} save={save} onChoose={onChoose} onSave={onSave} />
      {nextWay && <p className="next-way">Not the one you hold? {nextWay}</p>}
    </>
  );
}

function withPick(picks: Picks, trait: Trait, value: string | undefined): Picks {
  const { [trait]: _, ...others } = picks;
  return value === undefined ? others : { ...others, [trait]: value };
}

function NarrowRow({ difference, picked, onPick }: { difference: Difference; picked: string | undefined; onPick: (value: string | undefined) => void }) {
  const { label, where } = traitNames[difference.trait];
  const labelId = `narrow-${difference.trait}`;
  return (
    <div className="narrow-row" role="group" aria-labelledby={labelId}>
      <p className="narrow-label">
        <span id={labelId}>{label}</span> <span className="hint">{where}</span>
      </p>
      <div className="chips">
        {difference.options.map(({ value, count }) => (
          <button className="chip" type="button" key={value} aria-pressed={value === picked} onClick={() => onPick(value === picked ? undefined : value)}>
            {value} <span className="chip-count tnum">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function factText(trait: Trait, value: string) {
  return value === notListed ? `${traitNames[trait].label} not listed` : value;
}

function CandidateList({
  candidates,
  differences,
  picks,
  chosen,
  save,
  onChoose,
  onSave,
}: {
  candidates: LookupCandidate[];
  /** The details that tell these candidates apart; a row shows only those. */
  differences: Difference[];
  picks: Picks;
  chosen: number | null;
  save: Save;
  onChoose: (discogsReleaseId: number | null) => void;
  onSave: (candidate: LookupCandidate) => void;
}) {
  return (
    <ol className="rows">
      {candidates.map((candidate) => {
        const isChosen = candidate.discogsReleaseId === chosen;
        const panelId = `save-${candidate.discogsReleaseId}`;
        const facts = [candidate.pressingYear, candidate.country, candidate.label, candidate.catalogNumber, candidate.formats.join(", ") || null].filter((fact) => fact !== null);
        const pills = differences.flatMap(({ trait, options }) =>
          options.filter(({ value }) => valuesOf(candidate, trait).includes(value)).map(({ value }) => ({ trait, value })),
        );
        return (
          <li className="candidate" key={candidate.discogsReleaseId} aria-current={isChosen ? "true" : undefined}>
            <div className="row">
              <Cover url={candidate.coverImageUrl} />
              <span className="row-text">
                <button className="row-link row-title" type="button" onClick={() => onChoose(candidate.discogsReleaseId)} aria-expanded={isChosen} aria-controls={panelId}>
                  {candidate.title}
                </button>
                <span className="row-artist">{candidate.artist}</span>
                {differences.length === 0 ? (
                  <span className="row-meta">{facts.join(" · ")}</span>
                ) : (
                  <span className="facts">
                    {pills.map(({ trait, value }) => (
                      <span className="fact" key={`${trait}:${value}`} data-picked={picks[trait] === value || undefined}>
                        {factText(trait, value)}{" "}
                      </span>
                    ))}
                  </span>
                )}
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
                  <>
                    <p className="warning" role="alert">You already have {copiesText(candidate.copiesInCollection)} of this. Add another?</p>
                    <p className="where">{whereHeld(candidate.held)}</p>
                  </>
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
  );
}
