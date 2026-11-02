import type { ChangeEvent, ReactNode } from "react";
import type { LookupCandidate, LookupView } from "../server/collection.ts";
import type { CoverReading } from "../server/cover-reader.ts";
import { Cover } from "./Cover.tsx";
import { shrinkToJpegWithoutLocation } from "./photo-file.ts";

// Claude sees no more detail than this, so a bigger photo only costs upload time.
const coverPhotoLongEdge = 1568;

const unreachable = "LP-Collection can't reach its server right now. Try again in a moment.";

async function errorOf(response: Response) {
  const body = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  return body?.error ?? unreachable;
}

export type CoverLookup = { kind: "found"; reading: CoverReading; view: LookupView } | { kind: "unread"; reading: CoverReading } | { kind: "failed"; message: string };

/** Reads the artist and title off a photo of a cover, then looks them up on Discogs. */
export async function lookUpCover(collectionId: string, file: File): Promise<CoverLookup> {
  const jpeg = await shrinkToJpegWithoutLocation(file, coverPhotoLongEdge).catch(() => undefined);
  if (!jpeg) return { kind: "failed", message: "That photo couldn't be opened. Take or pick it again." };
  const api = `/api/collections/${collectionId}`;
  const read = await fetch(`${api}/cover-reading`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg }).catch(() => undefined);
  if (!read) return { kind: "failed", message: unreachable };
  if (!read.ok) return { kind: "failed", message: await errorOf(read) };
  const reading = (await read.json()) as CoverReading;
  if (!reading.artist && !reading.title) return { kind: "unread", reading };
  const lookup = await fetch(`${api}/lookup?${new URLSearchParams({ artist: reading.artist, title: reading.title })}`).catch(() => undefined);
  if (!lookup) return { kind: "failed", message: unreachable };
  if (!lookup.ok) return { kind: "failed", message: await errorOf(lookup) };
  return { kind: "found", reading, view: (await lookup.json()) as LookupView };
}

export const unreadCover = "The artist and title couldn't be made out on that photo. Take a closer, straighter photo of the front, or type them in.";

export function CoverPhotoButton({ busy, reading, onFile }: { busy: boolean; reading: boolean; onFile: (file: File) => void }) {
  function chosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) onFile(file);
  }
  return (
    <label className={busy ? "btn primary cover-photo busy" : "btn primary cover-photo"}>
      <input className="visually-hidden" type="file" accept="image/*" capture="environment" disabled={busy} onChange={chosen} />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
      {reading ? "Reading the cover…" : "Photo of the cover"}
    </label>
  );
}

/** The Release a Cover reading most likely is, big, with the one button that adds it. */
export function BestMatch({ candidate, children }: { candidate: LookupCandidate; children: ReactNode }) {
  const facts = [candidate.pressingYear, candidate.country, candidate.label, candidate.catalogNumber].filter((fact) => fact !== null);
  return (
    <div className="best-match" aria-label="Best match" role="group">
      <Cover url={candidate.coverImageUrl} className="cover big" />
      <div className="best-match-text">
        <h2>{candidate.title}</h2>
        <p className="row-artist">{candidate.artist}</p>
        <p className="row-meta">{facts.join(" · ")}</p>
      </div>
      {children}
    </div>
  );
}
