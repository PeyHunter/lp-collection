import { useEffect, useState } from "react";
import type { CopyView } from "../server/collection.ts";
import type { ShelfView } from "../server/shelves.ts";
import { followLink } from "./navigation.ts";
import { ShelfPhoto } from "./ShelfPhoto.tsx";
import { locationLabel, sectionLabel } from "./shelf-grid.ts";
import type { ShelfList } from "./ShelvesScreen.tsx";

type Saving = { kind: "idle" } | { kind: "saving" } | { kind: "failed" };

/** Where the Copy lives: its Section picked out on the Shelf photo, and one pick to put it somewhere else. */
export function PlaceSection({ copy, collectionId, onMoved }: { copy: CopyView; collectionId: string; onMoved: () => void }) {
  const [shelves, setShelves] = useState<ShelfView[] | undefined>();
  const [saving, setSaving] = useState<Saving>({ kind: "idle" });

  useEffect(() => {
    fetch(`/api/collections/${collectionId}/shelves`)
      .then(async (response) => response.ok && setShelves(((await response.json()) as ShelfList).shelves))
      .catch(() => undefined);
  }, [collectionId]);

  async function putIn(sectionId: string | null) {
    setSaving({ kind: "saving" });
    const response = await fetch(`/api/collections/${collectionId}/copies/${copy.id}/section`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sectionId }),
    }).catch(() => undefined);
    if (!response?.ok) return setSaving({ kind: "failed" });
    setSaving({ kind: "idle" });
    onMoved();
  }

  const { location } = copy;
  const shelf = location && shelves?.find((one) => one.id === location.shelfId);

  return (
    <section className="section" aria-labelledby="place-heading" aria-busy={saving.kind === "saving"}>
      <div className="section-head">
        <h2 id="place-heading">Shelf</h2>
        <span className="count">{location ? locationLabel(location) : "Not on a shelf"}</span>
      </div>
      {shelf && location && (
        <ShelfPhoto
          photo={shelf.photo}
          corners={shelf.corners}
          columns={shelf.columns}
          rows={shelf.rows}
          labels={false}
          highlight={location}
          label={`${shelf.name} with ${sectionLabel(location.column, location.row)} picked out`}
        />
      )}
      {shelves && shelves.length === 0 && (
        <p className="hint">
          <a href="/shelves/new" onClick={followLink}>
            Set up a Shelf
          </a>{" "}
          to give this Copy a place.
        </p>
      )}
      {shelves && shelves.length > 0 && (
        <div className="field">
          <label htmlFor="place">{location ? "Move to" : "Put in"}</label>
          <select className="input" id="place" value={location?.sectionId ?? ""} disabled={saving.kind === "saving"} onChange={(event) => putIn(event.currentTarget.value || null)}>
            <option value="">Not on a shelf</option>
            {shelves.map((one) => (
              <optgroup key={one.id} label={one.name}>
                {one.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {locationLabel({ shelfName: one.name, ...section })}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      {location && (
        <button className="btn quiet" type="button" disabled={saving.kind === "saving"} onClick={() => putIn(null)}>
          Take off the shelf
        </button>
      )}
      {saving.kind === "failed" && (
        <p className="notice error" role="alert">
          The Copy wasn't moved. Check your connection and try again.
        </p>
      )}
    </section>
  );
}
