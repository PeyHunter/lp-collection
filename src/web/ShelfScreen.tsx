import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from "react";
import type { ShelfCorners } from "../server/schema.ts";
import type { ShelfView } from "../server/shelves.ts";
import type { Me } from "./App.tsx";
import { Header } from "./Header.tsx";
import { navigate } from "./navigation.ts";
import { shrinkToJpegWithoutLocation } from "./photo-file.ts";
import { ConfirmDelete } from "./Photos.tsx";
import { ShelfPhoto, type ShelfImage } from "./ShelfPhoto.tsx";
import { copiesIn, type ShelfList } from "./ShelvesScreen.tsx";
import { isConvex, maxGridSide, sectionLabel } from "./shelf-grid.ts";

const shelfPhotoLongEdge = 2560;
const connectionLost = "Check your connection and try again.";
const startingCorners: ShelfCorners = [
  { x: 0.12, y: 0.12 },
  { x: 0.88, y: 0.12 },
  { x: 0.88, y: 0.88 },
  { x: 0.12, y: 0.88 },
];
const cornerNames = ["Top left", "Top right", "Bottom right", "Bottom left"] as const;

type Draft = { name: string; columns: number; rows: number; corners: ShelfCorners; photo: (ShelfImage & { jpeg?: Blob }) | null };
type ScreenState = { kind: "loading" } | { kind: "failed" } | { kind: "not-found" } | { kind: "editing"; saved: ShelfView | null; draft: Draft };
type Saving = { kind: "idle" } | { kind: "saving" } | { kind: "failed"; message: string };
type PhotoReading = "idle" | "reading" | "failed";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

async function errorMessage(response: Response | undefined) {
  const body = (await response?.json().catch(() => undefined)) as { error?: string } | undefined;
  return body?.error ?? connectionLost;
}

async function readPhoto(file: File) {
  const jpeg = await shrinkToJpegWithoutLocation(file, shelfPhotoLongEdge);
  const bitmap = await createImageBitmap(jpeg);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return { ...size, jpeg, url: URL.createObjectURL(jpeg) };
}

function copiesLeavingGrid(saved: ShelfView | null, draft: Draft) {
  if (!saved) return 0;
  return saved.sections.filter((section) => section.column > draft.columns || section.row > draft.rows).reduce((total, section) => total + section.copyCount, 0);
}

export function ShelfScreen({ me, shelfId }: { me: Me; shelfId: string | null }) {
  const shelvesUrl = `/api/collections/${me.collection.id}/shelves`;
  const shelfUrl = shelfId === null ? null : `${shelvesUrl}/${encodeURIComponent(shelfId)}`;
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [saving, setSaving] = useState<Saving>({ kind: "idle" });
  const [reading, setReading] = useState<PhotoReading>("idle");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    fetch(shelfUrl ?? shelvesUrl)
      .then(async (response) => {
        if (response.status === 404) return setState({ kind: "not-found" });
        if (!response.ok) return setState({ kind: "failed" });
        if (shelfUrl === null) {
          const { shelves } = (await response.json()) as ShelfList;
          const draft: Draft = { name: `Shelf ${shelves.length + 1}`, columns: 4, rows: 6, corners: startingCorners, photo: null };
          return setState({ kind: "editing", saved: null, draft });
        }
        const { shelf } = (await response.json()) as { shelf: ShelfView };
        setState({ kind: "editing", saved: shelf, draft: { ...shelf, photo: shelf.photo } });
      })
      .catch(() => setState({ kind: "failed" }));
  }, [shelfUrl, shelvesUrl, attempt]);

  const title = state.kind === "editing" && state.saved ? state.saved.name : shelfId === null ? "New Shelf" : "Shelf";

  return (
    <>
      <Header kicker="Shelf" title={title} back="/shelves" />
      <main className="content-grid">
        {state.kind === "loading" && <p className="loading">Loading the Shelf…</p>}
        {state.kind === "not-found" && <p className="notice error">This Shelf isn't in your Collection.</p>}
        {state.kind === "failed" && (
          <div className="notice error" role="alert">
            <p>The Shelf couldn't load. {connectionLost}</p>
            <button className="btn quiet" type="button" onClick={() => setAttempt((count) => count + 1)}>
              Try again
            </button>
          </div>
        )}
        {state.kind === "editing" && (
          <ShelfEditor
            saved={state.saved}
            draft={state.draft}
            saving={saving}
            reading={reading}
            onChange={(draft) => setState({ ...state, draft })}
            onPhoto={async (file) => {
              setReading("reading");
              const photo = await readPhoto(file).catch(() => undefined);
              if (!photo) return setReading("failed");
              setReading("idle");
              setState({ ...state, draft: { ...state.draft, photo } });
            }}
            onSave={async () => {
              const { draft } = state;
              setSaving({ kind: "saving" });
              const body = new FormData();
              body.set("name", draft.name);
              body.set("columns", String(draft.columns));
              body.set("rows", String(draft.rows));
              body.set("corners", JSON.stringify(draft.corners));
              if (draft.photo?.jpeg) body.set("photo", draft.photo.jpeg, "shelf.jpg");
              const response = await fetch(shelfUrl ?? shelvesUrl, { method: shelfUrl ? "PUT" : "POST", body }).catch(() => undefined);
              if (!response?.ok) return setSaving({ kind: "failed", message: await errorMessage(response) });
              navigate("/shelves");
            }}
            onDelete={async () => {
              const response = await fetch(shelfUrl!, { method: "DELETE" }).catch(() => undefined);
              if (!response?.ok) return setSaving({ kind: "failed", message: await errorMessage(response) });
              navigate("/shelves");
            }}
          />
        )}
      </main>
    </>
  );
}

type EditorProps = {
  saved: ShelfView | null;
  draft: Draft;
  saving: Saving;
  reading: PhotoReading;
  onChange: (draft: Draft) => void;
  onPhoto: (file: File) => void;
  onSave: () => void;
  onDelete: () => Promise<void>;
};

function ShelfEditor({ saved, draft, saving, reading, onChange, onPhoto, onSave, onDelete }: EditorProps) {
  const leaving = copiesLeavingGrid(saved, draft);
  const cornersInOrder = isConvex(draft.corners);
  const name = draft.name.trim();
  const busy = saving.kind === "saving" || reading === "reading";

  function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) onPhoto(file);
  }

  const photoButton = (
    <label className={`btn add-photo ${draft.photo ? "quiet" : "primary"}${busy ? " busy" : ""}`}>
      <input className="visually-hidden" type="file" accept="image/*" disabled={busy} onChange={pickPhoto} />
      {reading === "reading" ? "Reading the photo…" : draft.photo ? "Retake photo" : "Take or pick a photo"}
    </label>
  );

  return (
    <>
      <section className="section" aria-labelledby="shelf-photo-heading" aria-busy={reading === "reading"}>
        <div className="section-head">
          <h2 id="shelf-photo-heading">Photo</h2>
          {draft.photo && (
            <span className="count tnum">
              {draft.columns} × {draft.rows}
            </span>
          )}
        </div>
        {draft.photo ? (
          <>
            <CornerEditor photo={draft.photo} corners={draft.corners} columns={draft.columns} rows={draft.rows} onChange={(corners) => onChange({ ...draft, corners })} />
            <p className="caption">Drag the four dots onto the shelf's outer corners until every square sits on the photo.</p>
          </>
        ) : (
          <p className="lead">Photograph the whole shelf from the front with the normal camera, a few steps back, so all four outer corners are in the picture.</p>
        )}
        {photoButton}
        {reading === "failed" && (
          <p className="notice error" role="alert">
            That photo couldn't be read. Take or pick it again.
          </p>
        )}
      </section>

      <section className="section" aria-labelledby="shelf-grid-heading">
        <div className="section-head">
          <h2 id="shelf-grid-heading">Squares</h2>
          <span className="count tnum">
            {sectionLabel(1, 1)} to {sectionLabel(draft.columns, draft.rows)}
          </span>
        </div>
        <div className="steppers">
          <Stepper label="Columns" what="column" value={draft.columns} onChange={(columns) => onChange({ ...draft, columns })} />
          <Stepper label="Rows" what="row" value={draft.rows} onChange={(rows) => onChange({ ...draft, rows })} />
        </div>
        <p className="caption">Columns get letters from the left, rows get numbers from the top.</p>
      </section>

      <section className="section" aria-labelledby="shelf-name-heading">
        <div className="section-head">
          <h2 id="shelf-name-heading">Name</h2>
        </div>
        <div className="field">
          <label htmlFor="shelf-name">Shelf name</label>
          <input id="shelf-name" className="input" value={draft.name} maxLength={60} autoComplete="off" onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })} />
        </div>
      </section>

      <section className="section" aria-label="Save">
        {leaving > 0 && (
          <p className="notice warning" role="status">
            {plural(leaving, "Copy is", "Copies are")} in squares outside the new grid. Saving moves {leaving === 1 ? "it" : "them"} to Not on a shelf.
          </p>
        )}
        {draft.photo && !cornersInOrder && (
          <p className="notice error" role="alert">
            The dots are crossed. Drag them onto the shelf's corners: top left, top right, bottom right, bottom left.
          </p>
        )}
        {saving.kind === "failed" && (
          <p className="notice error" role="alert">
            The Shelf wasn't saved. {saving.message}
          </p>
        )}
        <button className="btn primary" type="button" disabled={busy || !draft.photo || !cornersInOrder || !name} onClick={onSave}>
          {saving.kind === "saving" ? "Saving…" : "Save Shelf"}
        </button>
        {!draft.photo && <p className="caption">Take or pick a photo first.</p>}
        {draft.photo && !name && <p className="caption">Give the Shelf a name.</p>}
      </section>

      {saved && (
        <section className="section" aria-labelledby="delete-shelf-heading">
          <div className="section-head">
            <h2 id="delete-shelf-heading">Delete</h2>
          </div>
          <ConfirmDelete
            label="Delete this Shelf"
            question={copiesIn(saved) > 0 ? `Delete ${saved.name}? Its ${plural(copiesIn(saved), "Copy moves", "Copies move")} to Not on a shelf.` : `Delete ${saved.name}?`}
            onConfirm={onDelete}
          />
        </section>
      )}
    </>
  );
}

function Stepper({ label, what, value, onChange }: { label: string; what: string; value: number; onChange: (value: number) => void }) {
  const id = `stepper-${what}`;
  return (
    <div className="stepper" role="group" aria-labelledby={id}>
      <span id={id} className="stepper-label">
        {label}
      </span>
      <button className="icon-btn" type="button" aria-label={`One ${what} fewer`} disabled={value <= 1} onClick={() => onChange(value - 1)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 12h12" />
        </svg>
      </button>
      <output className="stepper-value tnum" aria-live="polite">
        {value}
      </output>
      <button className="icon-btn" type="button" aria-label={`One ${what} more`} disabled={value >= maxGridSide} onClick={() => onChange(value + 1)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 6v12M6 12h12" />
        </svg>
      </button>
    </div>
  );
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const arrowSteps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function CornerEditor({ photo, corners, columns, rows, onChange }: { photo: ShelfImage; corners: ShelfCorners; columns: number; rows: number; onChange: (corners: ShelfCorners) => void }) {
  const frame = useRef<HTMLDivElement>(null);

  function moveTo(index: number, x: number, y: number) {
    const next = [...corners] as ShelfCorners;
    next[index] = { x: clamp(x), y: clamp(y) };
    onChange(next);
  }

  function drag(index: number, event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const box = frame.current!.getBoundingClientRect();
    moveTo(index, (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  }

  function nudge(index: number, event: KeyboardEvent<HTMLButtonElement>) {
    const step = arrowSteps[event.key];
    if (!step) return;
    event.preventDefault();
    const size = event.shiftKey ? 0.02 : 0.004;
    moveTo(index, corners[index]!.x + step[0] * size, corners[index]!.y + step[1] * size);
  }

  return (
    <ShelfPhoto photo={photo} corners={corners} columns={columns} rows={rows} label="Shelf photo with its squares drawn over it" frameRef={frame}>
      {corners.map((corner, index) => (
        <button
          key={cornerNames[index]}
          className="corner"
          type="button"
          aria-label={`${cornerNames[index]} corner. Drag it, or use the arrow keys.`}
          style={{ insetInlineStart: `${corner.x * 100}%`, insetBlockStart: `${corner.y * 100}%` }}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => drag(index, event)}
          onKeyDown={(event) => nudge(index, event)}
        />
      ))}
    </ShelfPhoto>
  );
}
