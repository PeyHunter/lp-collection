import { useEffect, useState } from "react";

type Route = { page: "home" } | { page: "invite"; code: string };

function routeFrom(pathname: string): Route {
  const invite = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  return invite ? { page: "invite", code: decodeURIComponent(invite[1]!) } : { page: "home" };
}

const loginProblems = {
  "cookie-missing":
    "Your Discogs login didn't finish because this browser didn't keep its login cookie. This happens when cookies are blocked, or when the login started at a different address than this one. Allow cookies for this site, then log in again from this page.",
  expired: "Your Discogs login took too long. Log in again.",
  failed: "Discogs didn't confirm your login. Try again.",
} as const;

function loginProblemFrom(search: string) {
  const problem = new URLSearchParams(search).get("login");
  return problem !== null && problem in loginProblems ? loginProblems[problem as keyof typeof loginProblems] : undefined;
}

export function App() {
  const route = routeFrom(location.pathname);
  const loginProblem = loginProblemFrom(location.search);
  return (
    <main>
      <h1>LP-Collection</h1>
      {loginProblem && <p role="alert">{loginProblem}</p>}
      {route.page === "invite" ? <InvitePage code={route.code} /> : <HomePage />}
    </main>
  );
}

type Me = { discogsUsername: string; canCreateInvites: boolean; collection: { id: string } };

type HomeScreen = { kind: "loading" } | { kind: "unreachable" } | { kind: "signed-out" } | { kind: "signed-in"; me: Me };

function HomePage() {
  const [screen, setScreen] = useState<HomeScreen>({ kind: "loading" });

  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => {
        if (response.status === 401) return setScreen({ kind: "signed-out" });
        if (!response.ok) return setScreen({ kind: "unreachable" });
        setScreen({ kind: "signed-in", me: (await response.json()) as Me });
      })
      .catch(() => setScreen({ kind: "unreachable" }));
  }, []);

  async function logOut() {
    await fetch("/api/logout", { method: "POST" });
    setScreen({ kind: "signed-out" });
  }

  switch (screen.kind) {
    case "loading":
      return null;
    case "unreachable":
      return <p>LP-Collection can't reach its server right now. Try again in a moment.</p>;
    case "signed-out":
      return (
        <>
          <p>LP-Collection is invite only. Ask the app's Owner for an Invite link.</p>
          <p>
            Already a User? <a href="/api/login">Log in with Discogs</a>
          </p>
        </>
      );
    case "signed-in":
      return (
        <>
          <h2>Your Collection</h2>
          <p>No Copies yet.</p>
          {screen.me.canCreateInvites && <InviteCreator />}
          <p>Logged in as {screen.me.discogsUsername}.</p>
          <button type="button" onClick={logOut}>
            Log out
          </button>
        </>
      );
  }
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
    <section aria-labelledby="invite-heading">
      <h2 id="invite-heading">Invite someone</h2>
      <button type="button" onClick={create} disabled={state.kind === "creating"}>
        Create Invite
      </button>
      {state.kind === "failed" && <p>The Invite couldn't be created. Try again.</p>}
      {state.kind === "created" && (
        <>
          <p>
            <label htmlFor="invite-link">Invite link</label>{" "}
            <input id="invite-link" readOnly value={state.invite.url} onFocus={(event) => event.currentTarget.select()} />{" "}
            <button type="button" onClick={() => copy(state.invite)}>
              {state.copied ? "Copied" : "Copy link"}
            </button>
          </p>
          <p>Works once. Expires {formatDate(state.invite.expiresAt)}.</p>
        </>
      )}
    </section>
  );
}

type InviteStatus = { status: "valid"; expiresAt: string } | { status: "used" } | { status: "expired" } | { status: "unknown" };

type InviteScreen = { kind: "loading" } | { kind: "unreachable" } | { kind: "checked"; invite: InviteStatus };

const refusals = {
  used: "This Invite has already been used.",
  expired: "This Invite has expired.",
  unknown: "This Invite link isn't valid.",
} as const;

function InvitePage({ code }: { code: string }) {
  const [screen, setScreen] = useState<InviteScreen>({ kind: "loading" });

  useEffect(() => {
    fetch(`/api/invites/${encodeURIComponent(code)}`)
      .then(async (response) => {
        if (response.status >= 500) return setScreen({ kind: "unreachable" });
        setScreen({ kind: "checked", invite: (await response.json()) as InviteStatus });
      })
      .catch(() => setScreen({ kind: "unreachable" }));
  }, [code]);

  switch (screen.kind) {
    case "loading":
      return null;
    case "unreachable":
      return <p>LP-Collection can't reach its server right now. Try again in a moment.</p>;
    case "checked":
      if (screen.invite.status === "valid") {
        return (
          <>
            <h2>You're invited to LP-Collection</h2>
            <p>Log in with your Discogs account to get a Collection of your own.</p>
            <p>
              <a href={`/api/login?invite=${encodeURIComponent(code)}`}>Log in with Discogs</a>
            </p>
          </>
        );
      }
      return (
        <>
          <h2>{refusals[screen.invite.status]}</h2>
          <p>LP-Collection is invite only. Ask the app's Owner for a new Invite link.</p>
        </>
      );
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}
