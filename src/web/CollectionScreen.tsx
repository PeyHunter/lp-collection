import { useEffect, useState } from "react";
import type { CopyView } from "../server/collection.ts";
import type { Condition } from "../server/discogs.ts";
import type { Me } from "./App.tsx";
import { Header } from "./Header.tsx";
import { Cover } from "./Cover.tsx";
import { clearHandoff, followLink, readHandoff } from "./navigation.ts";

type CopiesState = { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; copies: CopyView[] };

export function CollectionScreen({ me, onLoggedOut }: { me: Me; onLoggedOut: () => void }) {
  const [state, setState] = useState<CopiesState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [handoff] = useState(readHandoff);

  useEffect(clearHandoff, []);

  useEffect(() => {
    fetch(`/api/collections/${me.collection.id}/copies`)
      .then(async (response) => {
        if (!response.ok) return setState({ kind: "failed" });
        setState({ kind: "loaded", copies: ((await response.json()) as { copies: CopyView[] }).copies });
      })
      .catch(() => setState({ kind: "failed" }));
  }, [me.collection.id, attempt]);

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

        {handoff && (
          <p className="notice done" role="status">
            Added {handoff.title} to your Collection.
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
                <CopyRow key={copy.id} copy={copy} fresh={copy.id === handoff?.savedCopyId} />
              ))}
            </ol>
          )}
        </section>

        {me.canCreateInvites && <InviteCreator />}

        <section className="account" aria-label="Account">
          <p>Logged in as {me.discogsUsername}.</p>
          <button className="btn quiet" type="button" onClick={logOut}>
            Log out
          </button>
        </section>
      </main>
    </>
  );
}

function CopyRow({ copy, fresh }: { copy: CopyView; fresh: boolean }) {
  const { release } = copy;
  const facts = [release.originalYear, release.label, release.catalogNumber].filter((fact) => fact !== null);
  return (
    <li className={fresh ? "row fresh" : "row"}>
      <Cover url={release.coverImageUrl} />
      <span className="row-text">
        <span className="row-title">{release.title}</span>
        <span className="row-artist">{release.artist}</span>
        <span className="row-meta tnum">{facts.join(" · ")}</span>
        <span className="row-meta">
          Media <Grade condition={copy.mediaCondition} /> · Sleeve <Grade condition={copy.sleeveCondition} />
        </span>
      </span>
      <span className="row-end no-value">No Value yet</span>
    </li>
  );
}

function Grade({ condition }: { condition: Condition }) {
  const [, name, short] = /^(.*) \((.*)\)$/.exec(condition)!;
  return (
    <abbr title={name}>
      {short}
    </abbr>
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
