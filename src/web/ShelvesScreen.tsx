import { useEffect, useState } from "react";
import type { ShelfView } from "../server/shelves.ts";
import type { Me } from "./App.tsx";
import { Header } from "./Header.tsx";
import { followLink } from "./navigation.ts";
import { ShelfPhoto } from "./ShelfPhoto.tsx";

export type ShelfList = { shelves: ShelfView[]; notOnAShelf: number };

type ListState = { kind: "loading" } | { kind: "failed" } | ({ kind: "loaded" } & ShelfList);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function copiesIn(shelf: ShelfView) {
  return shelf.sections.reduce((total, section) => total + section.copyCount, 0);
}

export function ShelvesScreen({ me }: { me: Me }) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    fetch(`/api/collections/${me.collection.id}/shelves`)
      .then(async (response) => {
        if (!response.ok) return setState({ kind: "failed" });
        setState({ kind: "loaded", ...((await response.json()) as ShelfList) });
      })
      .catch(() => setState({ kind: "failed" }));
  }, [me.collection.id, attempt]);

  return (
    <>
      <Header title="Shelves" />
      <main className="content-grid">
        <section className="section" aria-labelledby="shelves-heading" aria-busy={state.kind === "loading"}>
          <div className="section-head">
            <h2 id="shelves-heading">Your Shelves</h2>
            {state.kind === "loaded" && state.shelves.length > 0 && <span className="count tnum">{state.shelves.length}</span>}
          </div>
          {state.kind === "loading" && <p className="loading">Loading your Shelves…</p>}
          {state.kind === "failed" && (
            <div className="notice error" role="alert">
              <p>Your Shelves couldn't load. Check your connection and try again.</p>
              <button className="btn quiet" type="button" onClick={() => setAttempt((count) => count + 1)}>
                Try again
              </button>
            </div>
          )}
          {state.kind === "loaded" && state.shelves.length === 0 && (
            <p className="lead">No Shelves yet. Photograph a shelf once, and the app lays its squares over the photo so every Copy can get a place.</p>
          )}
          {state.kind === "loaded" && state.shelves.length > 0 && (
            <ul className="rows">
              {state.shelves.map((shelf) => (
                <li key={shelf.id} className="row">
                  <div className="shelf-thumb">
                    <ShelfPhoto photo={shelf.photo} corners={shelf.corners} columns={shelf.columns} rows={shelf.rows} labels={false} label={`Photo of ${shelf.name}`} />
                  </div>
                  <div className="row-text">
                    <a className="row-link row-title" href={`/shelves/${shelf.id}`} onClick={followLink}>
                      {shelf.name}
                    </a>
                    <span className="row-artist tnum">
                      {shelf.columns} × {shelf.rows} · {plural(shelf.sections.length, "Section", "Sections")}
                    </span>
                    <span className="row-meta tnum">{plural(copiesIn(shelf), "Copy", "Copies")}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {state.kind === "loaded" && state.notOnAShelf > 0 && (
            <p className="lead tnum">{plural(state.notOnAShelf, "Copy is", "Copies are")} Not on a shelf.</p>
          )}
          <a className="btn primary set-up-shelf" href="/shelves/new" onClick={followLink}>
            Set up a Shelf
          </a>
        </section>
      </main>
    </>
  );
}
