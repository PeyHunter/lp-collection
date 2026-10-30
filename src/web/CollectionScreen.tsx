import { useCallback, useEffect, useRef, useState } from "react";
import type { CopyView } from "../server/collection.ts";
import { currencies, type Currency } from "../server/discogs.ts";
import type { ListGroup, SortName } from "../server/listing.ts";
import type { Me } from "./App.tsx";
import { Header } from "./Header.tsx";
import { Cover } from "./Cover.tsx";
import { Grade } from "./Grade.tsx";
import { queryFromSearch, searchFromQuery, useCopyList, type ListQuery } from "./copy-list.ts";
import { ListControls, periodName } from "./ListControls.tsx";
import { followLink, useHandoff } from "./navigation.ts";
import { currencyUnit, RowValue, SellerSettingsGuide } from "./Value.tsx";

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const bandFormat = new Intl.NumberFormat("da-DK");

function GroupHeading({ sort, groupKey, currency, sellerSettingsMissing }: { sort: SortName; groupKey: string; currency: Currency; sellerSettingsMissing: boolean }) {
  const unit = <small>{currencyUnit(currency)}</small>;
  if (groupKey === "unknown") return <>Year unknown</>;
  switch (sort) {
    case "value":
      if (groupKey === "none") return sellerSettingsMissing ? <>Waits for seller settings</> : <>No Value yet</>;
      if (groupKey === "0") return <>Under 10{unit}</>;
      return (
        <>
          {bandFormat.format(Number(groupKey))}+{unit}
        </>
      );
    case "period":
      return (
        <>
          The {periodName(Number(groupKey)).slice(0, -1)}
          <span className="lower">s</span>
        </>
      );
    case "added":
      return <>{monthFormat.format(new Date(`${groupKey}-01T00:00:00Z`))}</>;
    default:
      return <>{groupKey}</>;
  }
}

function inGroups(copies: CopyView[], groups: ListGroup[]) {
  let start = 0;
  return groups.map((group) => {
    const slice = copies.slice(start, start + group.length);
    start += group.length;
    return { group, copies: slice };
  });
}

export function CollectionScreen({
  me,
  onCurrencyChanged,
  onLoggedOut,
}: {
  me: Me;
  onCurrencyChanged: (currency: Currency) => void;
  onLoggedOut: () => void;
}) {
  const [query, setQuery] = useState(() => queryFromSearch(location.search));
  const [attempt, setAttempt] = useState(0);
  const [controlsKey, setControlsKey] = useState(0);
  const handoff = useHandoff();
  const { list, values, loadMore } = useCopyList(me.collection.id, query, `${me.currency} ${attempt}`);
  const moreButton = useRef<HTMLButtonElement>(null);

  const changeQuery = useCallback((next: ListQuery) => {
    setQuery(next);
    const search = searchFromQuery(next);
    history.replaceState(history.state, "", search ? `/?${search}` : "/");
  }, []);

  useEffect(() => {
    const button = moreButton.current;
    if (!button) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && loadMore(), { rootMargin: "600px 0px" });
    observer.observe(button);
    return () => observer.disconnect();
  }, [loadMore]);

  async function logOut() {
    await fetch("/api/logout", { method: "POST" });
    onLoggedOut();
  }

  const filtered = query.q.trim() !== "" || query.period !== null || query.genre !== null;
  const loaded = list.kind === "loaded" ? list : undefined;

  return (
    <>
      <Header kicker="LP-Collection" title="Your Collection" />
      <main className="content-grid">
        <section className="poster" aria-labelledby="records-heading">
          <div className="rule" />
          <h2 id="records-heading" className="poster-h">
            The <span className="accent">records</span>
          </h2>
          {loaded && (
            <p className="sub">
              <b className="tnum">{loaded.total}</b> {loaded.total === 1 ? "LP" : "LPs"}
              {filtered ? " found" : ""}
            </p>
          )}
        </section>

        {loaded?.sellerSettingsMissing && (
          <SellerSettingsGuide url={me.sellerSettingsUrl} collectionId={me.collection.id} onValued={() => setAttempt((count) => count + 1)} />
        )}

        {handoff && (
          <p className="notice done" role="status">
            {handoff.kind === "saved" ? `Added ${handoff.title} to your Collection.` : `Deleted ${handoff.title} from your Collection.`}
          </p>
        )}

        {loaded && (loaded.total > 0 || filtered) && <ListControls key={controlsKey} query={query} facets={loaded.facets} onChange={changeQuery} />}

        <section className="section" aria-label="Copies" aria-busy={list.kind === "loading"}>
          {list.kind === "loading" && <p className="loading">Loading your Collection…</p>}
          {list.kind === "failed" && (
            <div className="notice error" role="alert">
              <p>Your Collection couldn't load. Check your connection and try again.</p>
              <button className="btn quiet" type="button" onClick={() => setAttempt((count) => count + 1)}>
                Try again
              </button>
            </div>
          )}
          {loaded && loaded.total === 0 && !filtered && (
            <div className="empty">
              <p>No Copies yet.</p>
              <a className="btn primary" href="/lookup" onClick={followLink}>
                Add your first record
              </a>
            </div>
          )}
          {loaded && loaded.total === 0 && filtered && (
            <div className="empty">
              <p>
                No Copies match{query.q.trim() ? ` “${query.q.trim()}”` : ""}
                {query.period !== null ? ` in the ${periodName(query.period)}` : ""}
                {query.genre !== null ? ` in ${query.genre}` : ""}.
              </p>
              <button
                className="btn quiet"
                type="button"
                onClick={() => {
                  changeQuery({ ...query, q: "", period: null, genre: null });
                  setControlsKey((count) => count + 1);
                }}
              >
                Show every Copy
              </button>
            </div>
          )}
          {loaded && loaded.copies.length > 0 && (
            <div className="groups">
              {inGroups(loaded.copies, loaded.groups).map(({ group, copies }) => (
                <section className={group.key === "none" || group.key === "unknown" ? "group muted" : "group"} key={group.key}>
                  <h3 className="group-h">
                    <span className="poster-h">
                      <GroupHeading sort={query.sort} groupKey={group.key} currency={me.currency} sellerSettingsMissing={loaded.sellerSettingsMissing} />
                    </span>
                    <span className="n tnum">
                      {group.total} {group.total === 1 ? "LP" : "LPs"}
                    </span>
                  </h3>
                  <ol className="rows">
                    {copies.map((copy) => (
                      <CopyRow
                        key={copy.id}
                        copy={copy}
                        fresh={handoff?.kind === "saved" && copy.id === handoff.copyId}
                        sellerSettingsMissing={loaded.sellerSettingsMissing}
                        fetching={values.fetching}
                      />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
          {loaded?.next && (
            <button ref={moreButton} className="btn quiet more" type="button" onClick={loadMore} disabled={loaded.more === "loading"}>
              {loaded.more === "loading"
                ? "Loading more…"
                : loaded.more === "failed"
                  ? "More didn't load. Try again"
                  : `Show more (${loaded.total - loaded.copies.length} left)`}
            </button>
          )}
        </section>

        {me.canCreateInvites && <InviteCreator />}

        <section className="account" aria-label="Account">
          <CurrencySetting currency={me.currency} onChanged={onCurrencyChanged} />
          <p>Logged in as {me.discogsUsername}.</p>
          <button className="btn quiet" type="button" onClick={logOut}>
            Log out
          </button>
        </section>
      </main>
    </>
  );
}

function CopyRow({ copy, fresh, sellerSettingsMissing, fetching }: { copy: CopyView; fresh: boolean; sellerSettingsMissing: boolean; fetching: boolean }) {
  const { release } = copy;
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (fresh) row.current?.scrollIntoView({ block: "center" });
  }, [fresh]);
  const years = [release.originalYear, release.pressingYear !== null ? `pressed ${release.pressingYear}` : null];
  const facts = [...years, release.label, release.catalogNumber].filter((fact) => fact !== null);
  return (
    <li ref={row} className={fresh ? "row fresh" : "row"}>
      <Cover url={copy.pictureUrl} />
      <span className="row-text">
        <a className="row-title row-link" href={`/copies/${copy.id}`} onClick={followLink}>
          {release.title}
        </a>
        <span className="row-artist">{release.artist}</span>
        <span className="row-meta tnum">{facts.join(" · ")}</span>
        <span className="row-meta">
          Media <Grade condition={copy.mediaCondition} /> · Sleeve <Grade condition={copy.sleeveCondition} />
        </span>
      </span>
      <RowValue value={copy.value} sellerSettingsMissing={sellerSettingsMissing} fetching={fetching} />
    </li>
  );
}

type CurrencyState = { kind: "idle" } | { kind: "saving" } | { kind: "failed" };

function CurrencySetting({ currency, onChanged }: { currency: Currency; onChanged: (currency: Currency) => void }) {
  const [state, setState] = useState<CurrencyState>({ kind: "idle" });

  async function change(next: Currency) {
    setState({ kind: "saving" });
    const response = await fetch("/api/me/currency", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currency: next }),
    }).catch(() => undefined);
    if (!response?.ok) return setState({ kind: "failed" });
    setState({ kind: "idle" });
    onChanged(next);
  }

  return (
    <div className="field">
      <label htmlFor="currency">Currency</label>
      <select className="input" id="currency" value={currency} disabled={state.kind === "saving"} onChange={(event) => change(event.currentTarget.value as Currency)}>
        {currencies.map((code) => (
          <option key={code}>{code}</option>
        ))}
      </select>
      <p className="hint" role={state.kind === "failed" ? "alert" : undefined}>
        {state.kind === "failed" ? "The currency couldn't be saved. Try again." : "Values show in this currency."}
      </p>
    </div>
  );
}

type CreatedInvite = { url: string; expiresAt: string };

type InviteCreatorState = { kind: "idle" } | { kind: "creating" } | { kind: "failed" } | { kind: "created"; invite: CreatedInvite; copied: boolean };

function InviteCreator() {
  const [state, setState] = useState<InviteCreatorState>({ kind: "idle" });

  async function create() {
    setState({ kind: "creating" });
    const response = await fetch("/api/invites", { method: "POST" }).catch(() => undefined);
    if (!response?.ok) return setState({ kind: "failed" });
    setState({ kind: "created", invite: (await response.json()) as CreatedInvite, copied: false });
  }

  async function copy(invite: CreatedInvite) {
    await navigator.clipboard.writeText(invite.url);
    setState({ kind: "created", invite, copied: true });
  }

  return (
    <section className="section" aria-labelledby="invite-heading">
      <div className="section-head">
        <h2 id="invite-heading">Invite someone</h2>
      </div>
      <p className="lead">An Invite lets one person log in with Discogs and get a Collection of their own.</p>
      <p>
        <button className="btn secondary" type="button" onClick={create} disabled={state.kind === "creating"}>
          Create Invite
        </button>
      </p>
      {state.kind === "failed" && (
        <p className="notice error" role="alert">
          The Invite couldn't be created. Try again.
        </p>
      )}
      {state.kind === "created" && (
        <div className="invite-link">
          <div className="field">
            <label htmlFor="invite-link">Invite link</label>
            <div className="field-row">
              <input className="input" id="invite-link" readOnly value={state.invite.url} onFocus={(event) => event.currentTarget.select()} />
              <button className="btn primary" type="button" onClick={() => copy(state.invite)}>
                {state.copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
          <p className="hint">Works once. Expires {formatDate(state.invite.expiresAt)}.</p>
        </div>
      )}
    </section>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}
