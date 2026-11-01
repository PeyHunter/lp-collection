import { useEffect, useRef, useState } from "react";
import type { Me } from "./App.tsx";
import { Cover } from "./Cover.tsx";
import { queryFromSearch, searchFromQuery, shownQuery, useCopyList } from "./copy-list.ts";
import { Header } from "./Header.tsx";
import { followLink } from "./navigation.ts";
import { Amount, hasValues, ValuesSwitch } from "./Value.tsx";

/** Covers this many slides either side of the one in view are loaded; the rest wait until the User gets near. */
const coversAround = 2;
/** The next page of Copies is asked for this many slides before the last one loaded. */
const loadAhead = 5;

function startingSlide() {
  const at = Number(new URLSearchParams(location.search).get("at"));
  return Number.isSafeInteger(at) && at > 0 ? at : 0;
}

/**
 * The Collection as big covers, one at a time, in the order and with the filters of the list it came from. Swiping
 * left or right moves through them, like flipping through a record crate. The slide in view is kept in the address,
 * so coming back from a Copy lands on the same cover.
 */
export function BrowseScreen({ me, onShowValuesChanged }: { me: Me; onShowValuesChanged: (showValues: boolean) => void }) {
  const [query] = useState(() => queryFromSearch(location.search));
  const shown = shownQuery(query, me.showValues);
  const { list, loadMore } = useCopyList(me.collection.id, shown, `${me.currency} ${me.showValues}`);
  const [at, setAt] = useState(startingSlide);
  const crate = useRef<HTMLOListElement>(null);
  const restored = useRef(false);
  const listSearch = searchFromQuery(shown);
  const loaded = list.kind === "loaded" ? list : undefined;

  useEffect(() => {
    if (!loaded) return;
    if (at >= loaded.copies.length - loadAhead && loaded.next && loaded.more === "idle") void loadMore();
  }, [at, loaded, loadMore]);

  useEffect(() => {
    const element = crate.current;
    if (!loaded || !element || restored.current) return;
    if (at < loaded.copies.length || !loaded.next) {
      restored.current = true;
      element.scrollTo({ left: Math.min(at, loaded.copies.length - 1) * element.clientWidth, behavior: "instant" });
    }
  }, [loaded, at]);

  function onScroll() {
    const element = crate.current;
    if (!element || !restored.current) return;
    const slide = Math.round(element.scrollLeft / element.clientWidth);
    if (slide === at) return;
    setAt(slide);
    const params = new URLSearchParams(listSearch);
    if (slide > 0) params.set("at", String(slide));
    history.replaceState(history.state, "", `/browse${params.size ? `?${params}` : ""}`);
  }

  function step(by: number) {
    const element = crate.current;
    element?.scrollBy({ left: by * element.clientWidth, behavior: "smooth" });
  }

  const total = loaded?.total ?? 0;
  const copy = loaded?.copies[at];

  return (
    <>
      <Header
        kicker="Browse"
        title="Covers"
        back={listSearch ? `/?${listSearch}` : "/"}
        end={<ValuesSwitch showValues={me.showValues} onChanged={onShowValuesChanged} />}
      />
      <main className="browse">
        {list.kind === "loading" && <p className="loading">Loading covers…</p>}
        {list.kind === "failed" && (
          <p className="notice error" role="alert">
            The covers couldn't load. Check your connection and try again.
          </p>
        )}
        {loaded && total === 0 && <p>No Copies match. Go back to change the search or filters.</p>}
        {loaded && total > 0 && (
          <>
            <ol className="crate" ref={crate} onScroll={onScroll} aria-label="Covers">
              {loaded.copies.map((each, index) => (
                <li key={each.id} className="crate-slide" aria-roledescription="slide" aria-label={`${index + 1} of ${total}`} aria-current={index === at ? "true" : undefined}>
                  <a className="crate-link" href={`/copies/${each.id}`} onClick={followLink}>
                    {Math.abs(index - at) <= coversAround ? <Cover url={each.pictureUrl} className="cover crate-cover" /> : <span className="cover crate-cover none" aria-hidden="true" />}
                    <span className="crate-title">{each.release.title}</span>
                  </a>
                  <span className="crate-artist">{each.release.artist}</span>
                  {me.showValues && hasValues(each) && each.value?.value != null && <Amount amount={each.value.value} currency={each.value.currency} className="crate-value" />}
                </li>
              ))}
            </ol>
            <div className="crate-controls">
              <button className="btn quiet" type="button" onClick={() => step(-1)} disabled={at === 0}>
                Previous
              </button>
              <p className="crate-position tnum" role="status">
                {at + 1} of {total}
                {copy ? <span className="visually-hidden">: {copy.release.title}</span> : null}
              </p>
              <button className="btn quiet" type="button" onClick={() => step(1)} disabled={at >= total - 1}>
                Next
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
