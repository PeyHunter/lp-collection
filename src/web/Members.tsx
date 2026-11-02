import { useEffect, useState, type FormEvent } from "react";
import type { MemberView } from "../server/members.ts";
import type { Me } from "./App.tsx";

const chosenKey = "lp-collection.collection";

/** The Collection this device last switched to, if the User is still a Member of it; otherwise their own. */
export function chosenCollection(me: Me): Me["collection"] {
  const chosen = localStorage.getItem(chosenKey);
  return me.collections.find((collection) => collection.id === chosen) ?? me.collection;
}

export function collectionTitle(me: Me) {
  const current = me.collections.find((collection) => collection.id === me.collection.id);
  return !current || current.own ? "Your Collection" : `${current.ownerDiscogsUsername}'s Collection`;
}

/** One tap between every Collection the User is a Member of. Shown only to Users in more than one. */
export function CollectionSwitcher({ me, onSwitched }: { me: Me; onSwitched: (collection: Me["collection"]) => void }) {
  if (me.collections.length < 2) return null;
  return (
    <fieldset className="chips collection-switcher">
      <legend className="visually-hidden">Collection</legend>
      {me.collections.map((collection) => (
        <label className="chip" key={collection.id}>
          <input
            type="radio"
            name="collection"
            checked={collection.id === me.collection.id}
            onChange={() => {
              localStorage.setItem(chosenKey, collection.id);
              onSwitched({ id: collection.id });
            }}
          />
          {collection.own ? "Yours" : `${collection.ownerDiscogsUsername}'s`}
        </label>
      ))}
    </fieldset>
  );
}

type AddState = { kind: "idle" } | { kind: "adding" } | { kind: "failed"; message: string };

/** Who looks after this Collection. The Owner adds a User by their Discogs username and removes Members here. */
export function MembersSection({ me }: { me: Me }) {
  const [members, setMembers] = useState<MemberView[]>();
  const [attempt, setAttempt] = useState(0);
  const [username, setUsername] = useState("");
  const [state, setState] = useState<AddState>({ kind: "idle" });
  const url = `/api/collections/${me.collection.id}/members`;
  const isOwner = me.collections.find((collection) => collection.id === me.collection.id)?.own ?? true;

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => response.ok && setMembers(((await response.json()) as { members: MemberView[] }).members))
      .catch(() => undefined);
    return () => controller.abort();
  }, [url, attempt]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setState({ kind: "adding" });
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ discogsUsername: username }) }).catch(() => undefined);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => undefined)) as { error?: string } | undefined;
      return setState({ kind: "failed", message: body?.error ?? "The Member couldn't be added. Check your connection and try again." });
    }
    setUsername("");
    setState({ kind: "idle" });
    setAttempt((count) => count + 1);
  }

  async function remove(userId: string) {
    const response = await fetch(`${url}/${userId}`, { method: "DELETE" }).catch(() => undefined);
    if (response?.ok) setAttempt((count) => count + 1);
  }

  if (!members) return null;
  return (
    <section className="section" aria-labelledby="members-heading">
      <div className="section-head">
        <h2 id="members-heading">Members</h2>
        <span className="count">{members.length}</span>
      </div>
      <ul className="rows">
        {members.map((member) => (
          <li className="row member-row" key={member.userId}>
            <span className="row-text">
              <span className="row-title">{member.discogsUsername}</span>
              <span className="row-meta">{member.owner ? "Owner" : "Member"}</span>
            </span>
            {isOwner && !member.owner && (
              <button className="btn quiet" type="button" onClick={() => remove(member.userId)} aria-label={`Remove ${member.discogsUsername}`}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <form className="field" onSubmit={add}>
          <label htmlFor="new-member">Add a Member by Discogs username</label>
          <div className="inline-form">
            <input className="input" id="new-member" value={username} onChange={(event) => setUsername(event.currentTarget.value)} autoCapitalize="none" autoComplete="off" required />
            <button className="btn secondary" type="submit" disabled={state.kind === "adding"}>
              Add
            </button>
          </div>
          <p className="hint" role={state.kind === "failed" ? "alert" : undefined}>
            {state.kind === "failed" ? state.message : "They need to have logged in once, through an Invite. Members can add, change and delete Copies."}
          </p>
        </form>
      )}
    </section>
  );
}
