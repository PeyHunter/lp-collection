import { useState, type ChangeEvent } from "react";
import type { CopyView } from "../server/collection.ts";
import { shrinkToJpegWithoutLocation } from "./photo-file.ts";

type Adding = { kind: "idle" } | { kind: "adding"; done: number; of: number } | { kind: "failed"; message: string };

const connectionLost = "Check your connection and try again.";

async function errorMessage(response: Response | undefined) {
  const body = (await response?.json().catch(() => undefined)) as { error?: string } | undefined;
  return body?.error ?? connectionLost;
}

export function PhotosSection({ copy, copyUrl, onChanged }: { copy: CopyView; copyUrl: string; onChanged: (copy: CopyView) => void }) {
  const [adding, setAdding] = useState<Adding>({ kind: "idle" });
  const [deleteFailed, setDeleteFailed] = useState(false);
  const count = copy.photos.length;

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    setDeleteFailed(false);
    for (const [index, file] of files.entries()) {
      setAdding({ kind: "adding", done: index, of: files.length });
      const jpeg = await shrinkToJpegWithoutLocation(file).catch(() => undefined);
      if (!jpeg) return setAdding({ kind: "failed", message: "That photo couldn't be read. Take or pick it again." });
      const response = await fetch(`${copyUrl}/photos`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg }).catch(() => undefined);
      if (!response?.ok) return setAdding({ kind: "failed", message: await errorMessage(response) });
      onChanged(((await response.json()) as { copy: CopyView }).copy);
    }
    setAdding({ kind: "idle" });
  }

  async function remove(photoId: string) {
    setDeleteFailed(false);
    const response = await fetch(`${copyUrl}/photos/${photoId}`, { method: "DELETE" }).catch(() => undefined);
    if (!response?.ok) return setDeleteFailed(true);
    onChanged(((await response.json()) as { copy: CopyView }).copy);
  }

  const busy = adding.kind === "adding";

  return (
    <section className="section" aria-labelledby="photos-heading" aria-busy={busy}>
      <div className="section-head">
        <h2 id="photos-heading">Photos</h2>
        {count > 0 && <span className="count tnum">{count}</span>}
      </div>
      {count === 0 ? (
        <p className="lead">No photos yet. The Discogs cover shows until you add one of your own Copy.</p>
      ) : (
        <ul className="photos">
          {copy.photos.map((photo, index) => (
            <li key={photo.id} className="photo">
              <img src={photo.url} width={photo.width} height={photo.height} alt={`Photo ${index + 1} of ${copy.release.title}`} />
              <ConfirmDelete label={`Delete photo ${index + 1}`} question="Delete this photo?" onConfirm={() => remove(photo.id)} />
            </li>
          ))}
        </ul>
      )}
      <label className={busy ? "btn primary add-photo busy" : "btn primary add-photo"}>
        <input className="visually-hidden" type="file" accept="image/*" multiple disabled={busy} onChange={add} />
        {busy ? (adding.of > 1 ? `Adding photo ${adding.done + 1} of ${adding.of}…` : "Adding photo…") : "Take or pick a photo"}
      </label>
      {adding.kind === "failed" && (
        <p className="notice error" role="alert">
          The photo wasn't added. {adding.message}
        </p>
      )}
      {deleteFailed && (
        <p className="notice error" role="alert">
          The photo wasn't deleted. {connectionLost}
        </p>
      )}
    </section>
  );
}

type Confirming = "idle" | "asking" | "working";

const scrollIntoView = (element: HTMLElement | null) => element?.scrollIntoView({ block: "center" });

export function ConfirmDelete({
  label,
  question,
  confirmLabel = "Delete",
  onConfirm,
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
}) {
  const [state, setState] = useState<Confirming>("idle");

  async function confirm() {
    setState("working");
    await onConfirm();
    setState("idle");
  }

  if (state === "idle") {
    return (
      <button className="btn quiet danger" type="button" onClick={() => setState("asking")}>
        {label}
      </button>
    );
  }
  return (
    <div className="confirm" role="group" aria-label={question} ref={scrollIntoView}>
      <p>{question}</p>
      <div className="confirm-actions">
        <button className="btn danger-fill" type="button" disabled={state === "working"} onClick={confirm}>
          {state === "working" ? "Deleting…" : confirmLabel}
        </button>
        <button className="btn secondary" type="button" disabled={state === "working"} onClick={() => setState("idle")}>
          Keep it
        </button>
      </div>
    </div>
  );
}
