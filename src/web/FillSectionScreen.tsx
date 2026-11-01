import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CopyView, LookupCandidate, LookupView } from "../server/collection.ts";
import type { ShelfView } from "../server/shelves.ts";
import type { Me } from "./App.tsx";
import { Cover } from "./Cover.tsx";
import { Header } from "./Header.tsx";
import { Scanner } from "./Scanner.tsx";
import { ShelfPhoto } from "./ShelfPhoto.tsx";
import { locationLabel, sectionLabel } from "./shelf-grid.ts";

type Held = LookupCandidate["held"][number];

/** What the last scan or search asks of the Member, if anything. */
type Step =
  | { kind: "ready" }
  | { kind: "busy" }
  | { kind: "placed"; title: string }
  | { kind: "which"; title: string; held: Held[] }
  | { kind: "unknown"; candidates: LookupCandidate[] }
  | { kind: "not-found"; barcode: string }
  | { kind: "failed"; message: string };

const connectionLost = "Check your connection and try again.";

/** Scan records one after another; each one the Collection holds goes into this Section. */
export function FillSectionScreen({ me, shelfId, sectionId }: { me: Me; shelfId: string; sectionId: string }) {
  const api = `/api/collections/${me.collection.id}`;
  const [shelf, setShelf] = useState<ShelfView | null | undefined>();
  const [step, setStep] = useState<Step>({ kind: "ready" });
  const [placed, setPlaced] = useState(0);
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<CopyView[]>([]);
  const lastRead = useRef<{ barcode: string; at: number } | null>(null);

  useEffect(() => {
    fetch(`${api}/shelves/${encodeURIComponent(shelfId)}`)
      .then(async (response) => setShelf(response.ok ? ((await response.json()) as { shelf: ShelfView }).shelf : null))
      .catch(() => setShelf(null));
  }, [api, shelfId]);

  useEffect(() => {
    const q = search.trim();
    if (!q) return setFound([]);
    const abort = new AbortController();
    const settle = setTimeout(async () => {
      const response = await fetch(`${api}/copies?${new URLSearchParams({ q, sort: "artist", limit: "10" })}`, { signal: abort.signal }).catch(() => undefined);
      if (response?.ok) setFound(((await response.json()) as { copies: CopyView[] }).copies);
    }, 250);
    return () => {
      clearTimeout(settle);
      abort.abort();
    };
  }, [api, search, placed]);

  const section = shelf?.sections.find((one) => one.id === sectionId);
  const here = shelf && section ? locationLabel({ shelfName: shelf.name, ...section }) : "";

  async function place(copyId: string, title: string) {
    setStep({ kind: "busy" });
    const response = await fetch(`${api}/copies/${copyId}/section`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sectionId }),
    }).catch(() => undefined);
    if (!response?.ok) return setStep({ kind: "failed", message: `${title} wasn't placed. ${connectionLost}` });
    setPlaced((count) => count + 1);
    setStep({ kind: "placed", title });
  }

  async function addAndPlace(candidate: LookupCandidate) {
    setStep({ kind: "busy" });
    const response = await fetch(`${api}/copies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ discogsReleaseId: candidate.discogsReleaseId, sectionId }),
    }).catch(() => undefined);
    if (!response?.ok) return setStep({ kind: "failed", message: `${candidate.title} wasn't added. ${connectionLost}` });
    setPlaced((count) => count + 1);
    setStep({ kind: "placed", title: candidate.title });
  }

  async function scanned(barcode: string) {
    // The camera reads the same barcode many times a second while it is in view.
    const now = Date.now();
    if (lastRead.current?.barcode === barcode && now - lastRead.current.at < 4000) return;
    lastRead.current = { barcode, at: now };
    setStep({ kind: "busy" });
    const response = await fetch(`${api}/lookup?${new URLSearchParams({ barcode })}`).catch(() => undefined);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => undefined)) as { error?: string } | undefined;
      return setStep({ kind: "failed", message: body?.error ?? connectionLost });
    }
    const { candidates } = (await response.json()) as LookupView;
    const held = candidates.flatMap((candidate) => candidate.held.map((copy) => ({ ...copy, title: candidate.title })));
    if (held.length === 1) return place(held[0]!.copyId, held[0]!.title);
    if (held.length > 1) return setStep({ kind: "which", title: held[0]!.title, held });
    setStep(candidates.length > 0 ? { kind: "unknown", candidates } : { kind: "not-found", barcode });
  }

  function typedBarcode(event: FormEvent) {
    event.preventDefault();
    lastRead.current = null;
    if (typed.trim()) scanned(typed.trim());
  }

  return (
    <>
      <Header kicker="Fill a Section" title={here || "Section"} back={`/shelves/${shelfId}`} />
      <main className="content-grid">
        {shelf === null && <p className="notice error">This Shelf isn't in your Collection.</p>}
        {shelf && !section && <p className="notice error">This Section isn't on {shelf.name} any more.</p>}
        {shelf && section && (
          <>
            <section className="section" aria-label="Section">
              <ShelfPhoto
                photo={shelf.photo}
                corners={shelf.corners}
                columns={shelf.columns}
                rows={shelf.rows}
                labels={false}
                highlight={section}
                label={`${shelf.name} with ${sectionLabel(section.column, section.row)} picked out`}
              />
              <p className="sub" role="status">
                <b className="tnum">{placed}</b> placed in {sectionLabel(section.column, section.row)}
              </p>
            </section>

            <section className="section" aria-label="Scan">
              <Scanner onRead={scanned} />
              <form className="field-row" onSubmit={typedBarcode}>
                <input className="input" aria-label="Barcode" inputMode="numeric" autoComplete="off" value={typed} onChange={(event) => setTyped(event.currentTarget.value)} />
                <button className="btn secondary" type="submit">
                  Place
                </button>
              </form>
              <StepNotice step={step} here={here} onPlace={place} onAdd={addAndPlace} />
            </section>

            <section className="section" aria-labelledby="no-barcode-heading">
              <div className="section-head">
                <h2 id="no-barcode-heading">No barcode?</h2>
              </div>
              <input className="input" type="search" aria-label="Search the Collection" placeholder="Search artist or title…" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
              <ul className="rows">
                {found.map((copy) => (
                  <li className="row" key={copy.id}>
                    <Cover url={copy.pictureUrl} />
                    <span className="row-text">
                      <span className="row-title">{copy.release.title}</span>
                      <span className="row-artist">{copy.release.artist}</span>
                      <span className="row-meta">{copy.location ? locationLabel(copy.location) : "Not on a shelf"}</span>
                    </span>
                    <button className="btn secondary" type="button" disabled={copy.location?.sectionId === sectionId} onClick={() => place(copy.id, copy.release.title)}>
                      {copy.location?.sectionId === sectionId ? "Here" : `Place ${copy.release.title}`}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function StepNotice({
  step,
  here,
  onPlace,
  onAdd,
}: {
  step: Step;
  here: string;
  onPlace: (copyId: string, title: string) => void;
  onAdd: (candidate: LookupCandidate) => void;
}) {
  switch (step.kind) {
    case "ready":
      return <p className="hint">Scan a record, or type its barcode, to put it in {here}.</p>;
    case "busy":
      return <p className="loading">Looking…</p>;
    case "placed":
      return (
        <p className="notice done" role="status">
          Put {step.title} in {here}. Scan the next one.
        </p>
      );
    case "failed":
      return (
        <p className="notice error" role="alert">
          {step.message}
        </p>
      );
    case "not-found":
      return (
        <p className="notice error" role="alert">
          Discogs knows no record with barcode {step.barcode}. Find it under No barcode? if it is in your Collection.
        </p>
      );
    case "which":
      return (
        <div className="notice warning" role="alert">
          <p>You have {step.held.length} Copies of {step.title}. Which one goes here?</p>
          <div className="actions">
            {step.held.map((copy, index) => (
              <button className="btn secondary" type="button" key={copy.copyId} onClick={() => onPlace(copy.copyId, step.title)}>
                Copy {index + 1}: {copy.location ? locationLabel(copy.location) : "Not on a shelf"}
              </button>
            ))}
          </div>
        </div>
      );
    case "unknown":
      return (
        <div className="notice warning" role="alert">
          <p>This record isn't in your Collection yet. Add it to {here}?</p>
          <div className="actions">
            {step.candidates.map((candidate) => (
              <button className="btn primary" type="button" key={candidate.discogsReleaseId} onClick={() => onAdd(candidate)}>
                Add {candidate.title}
                {step.candidates.length > 1 ? ` (${[candidate.country, candidate.pressingYear].filter(Boolean).join(", ")})` : ""}
              </button>
            ))}
          </div>
        </div>
      );
  }
}
