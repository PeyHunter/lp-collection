import { useEffect, useState } from "react";
import type { CopyView } from "../server/collection.ts";
import type { Currency } from "../server/discogs.ts";
import { Cover } from "./Cover.tsx";
import { followLink } from "./navigation.ts";
import { Amount, hasValues, HistoryChart, type HistoryPoint } from "./Value.tsx";

type OverviewAnswer = {
  copies: number;
  collectionValue?: { amount: number; currency: Currency };
  mostValuable?: CopyView[];
  history?: HistoryPoint[];
};

type OverviewState = { kind: "loading" } | { kind: "failed" } | ({ kind: "loaded" } & OverviewAnswer);

/** The big picture at the top of the app: Collection value, number of Copies, its graph and the ten most valuable. The big Scan button is the dock's. */
export function Overview({ collectionId, reloadKey }: { collectionId: string; reloadKey: string }) {
  const [state, setState] = useState<OverviewState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/collections/${collectionId}/overview`, { signal: controller.signal })
      .then(async (response) => setState(response.ok ? { kind: "loaded", ...((await response.json()) as OverviewAnswer) } : { kind: "failed" }))
      .catch(() => controller.signal.aborted || setState({ kind: "failed" }));
    return () => controller.abort();
  }, [collectionId, reloadKey]);

  return (
    <section className="overview" aria-label="Overview">
      {state.kind === "loaded" && (
        <>
          <div className="overview-figures">
            {state.collectionValue && (
              <p className="overview-value">
                <small>Collection value</small>
                <Amount amount={state.collectionValue.amount} currency={state.collectionValue.currency} />
              </p>
            )}
            <p className="overview-count">
              <b className="tnum">{state.copies}</b> {state.copies === 1 ? "Copy" : "Copies"}
            </p>
          </div>
          {state.collectionValue && state.history && (
            <figure className="overview-graph">
              {state.history.filter((point) => point.value !== null).length >= 2 ? (
                <HistoryChart points={state.history} currency={state.collectionValue.currency} label="Collection value by month" />
              ) : (
                <figcaption className="hint">The graph of the Collection value starts after the second monthly refresh.</figcaption>
              )}
            </figure>
          )}
        </>
      )}
      {state.kind === "failed" && <p className="hint">The overview couldn't load.</p>}

      {state.kind === "loaded" && state.mostValuable && state.mostValuable.length > 0 && (
        <section className="section" aria-labelledby="most-valuable-heading">
          <div className="section-head">
            <h2 id="most-valuable-heading">Most valuable</h2>
            <span className="count">top {state.mostValuable.length}</span>
          </div>
          <ol className="rows">
            {state.mostValuable.map((copy) => (
              <li key={copy.id} className="row">
                <Cover url={copy.pictureUrl} />
                <span className="row-text">
                  <a className="row-title row-link" href={`/copies/${copy.id}`} onClick={followLink}>
                    {copy.release.title}
                  </a>
                  <span className="row-artist">{copy.release.artist}</span>
                </span>
                {hasValues(copy) && copy.value?.value != null && <Amount amount={copy.value.value} currency={copy.value.currency} className="row-end row-value" />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
