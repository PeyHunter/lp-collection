import { useEffect, useState } from "react";
import type { CopyView } from "../server/collection.ts";
import { currencies, type Currency } from "../server/discogs.ts";
import type { Me } from "./App.tsx";
import { Header } from "./Header.tsx";
import { Cover } from "./Cover.tsx";
import { Grade } from "./Grade.tsx";
import { followLink, useHandoff } from "./navigation.ts";
import { fetchValues, RowValue, SellerSettingsGuide } from "./Value.tsx";

type Copies = { copies: CopyView[]; sellerSettingsMissing: boolean };

type CopiesState = { kind: "loading" } | { kind: "failed" } | ({ kind: "loaded"; fetchingValues: boolean } & Copies);

export function CollectionScreen({
  me,
  onCurrencyChanged,
  onLoggedOut,
}: {
  me: Me;
  onCurrencyChanged: (currency: Currency) => void;
  onLoggedOut: () => void;
}) {
  const [state, setState] = useState<CopiesState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const handoff = useHandoff();

  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      const response = await fetch(`/api/collections/${me.collection.id}/copies`, { signal: abort.signal }).catch(() => undefined);
      if (abort.signal.aborted) return;
      if (!response?.ok) return setState({ kind: "failed" });
      const loaded = (await response.json()) as Copies;
      const fetchingValues = !loaded.sellerSettingsMissing && loaded.copies.some((copy) => !copy.value);
      setState({ kind: "loaded", ...loaded, fetchingValues });
      if (!fetchingValues) return;
      await fetchValues(me.collection.id, {
        signal: abort.signal,
        onBatch: ({ copies, sellerSettingsMissing, more }) => setState({ kind: "loaded", copies, sellerSettingsMissing, fetchingValues: more }),
      });
      if (!abort.signal.aborted) setState((state) => (state.kind === "loaded" ? { ...state, fetchingValues: false } : state));
    }
    load();
    return () => abort.abort();
  }, [me.collection.id, me.currency, attempt]);

  async function logOut() {
    await fetch("/api/logout", { method: "POST" });
    onLoggedOut();
  }

  const count = state.kind === "loaded" ? state.copies.length : undefined;

  return (
    <>
      <Header kicker="LP-Collection" title="Your Collection" />
      <main className="content-grid">
        <section className="poster" aria-labelledby="records-heading">
          <div className="rule" />
          <h2 id="records-heading" className="poster-h">
            The <span className="accent">records</span>
          </h2>
          {count !== undefined && (
            <p className="sub">
              <b className="tnum">{count}</b> {count === 1 ? "LP" : "LPs"}
            </p>
          )}
        </section>

        {state.kind === "loaded" && state.sellerSettingsMissing && (
          <SellerSettingsGuide url={me.sellerSettingsUrl} collectionId={me.collection.id} onValued={() => setAttempt((count) => count + 1)} />
        )}

        {handoff && (
          <p className="notice done" role="status">
            {handoff.kind === "saved" ? `Added ${handoff.title} to your Collection.` : `Deleted ${handoff.title} from your Collection.`}
          </p>
        )}

        <section className="section" aria-label="Copies" aria-busy={state.kind === "loading"}>
          {state.kind === "loading" && <p className="loading">Loading your Collection…</p>}
          {state.kind === "failed" && (
            <div className="notice error" role="alert">
              <p>Your Collection couldn't load. Check your connection and try again.</p>
              <button className="btn quiet" type="button" onClick={() => setAttempt((count) => count + 1)}>
                Try again
              </button>
            </div>
          )}
          {state.kind === "loaded" && state.copies.length === 0 && (
            <div className="empty">
              <p>No Copies yet.</p>
              <a className="btn primary" href="/lookup" onClick={followLink}>
                Add your first record
              </a>
            </div>
          )}
          {state.kind === "loaded" && state.copies.length > 0 && (
            <ol className="rows">
              {state.copies.map((copy) => (
                <CopyRow
                  key={copy.id}
                  copy={copy}
                  fresh={handoff?.kind === "saved" && copy.id === handoff.copyId}
                  sellerSettingsMissing={state.sellerSettingsMissing}
                  fetching={state.fetchingValues}
                />
              ))}
            </ol>
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
  const facts = [release.originalYear, release.label, release.catalogNumber].filter((fact) => fact !== null);
  return (
    <li className={fresh ? "row fresh" : "row"}>
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
