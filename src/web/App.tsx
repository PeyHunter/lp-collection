import { useEffect, useState, type ReactNode } from "react";
import { CollectionScreen } from "./CollectionScreen.tsx";
import { CopyScreen } from "./CopyScreen.tsx";
import { Header } from "./Header.tsx";
import { LookupScreen } from "./LookupScreen.tsx";
import { followLink, useRoute, type Route } from "./navigation.ts";
import type { Currency } from "../server/discogs.ts";

export type Me = { discogsUsername: string; canCreateInvites: boolean; collection: { id: string }; currency: Currency; sellerSettingsUrl: string };

const loginProblems = {
  "cookie-missing":
    "Your Discogs login didn't finish because this browser didn't keep its login cookie. This happens when cookies are blocked, or when the login started at a different address than this one. Allow cookies for this site, then log in again from this page.",
  expired: "Your Discogs login took too long. Log in again.",
  failed: "Discogs didn't confirm your login. Try again.",
  "too-many": "You started too many logins. Wait 15 minutes, then try again.",
  busy: "Too many people are logging in right now. Wait a minute, then try again.",
  "discogs-unavailable": "Discogs can't be reached right now. Try again in a moment.",
} as const;

function loginProblemFrom(search: string) {
  const problem = new URLSearchParams(search).get("login");
  return problem !== null && problem in loginProblems ? loginProblems[problem as keyof typeof loginProblems] : undefined;
}

export function App() {
  const route = useRoute();
  return route.page === "invite" ? <InvitePage code={route.code} /> : <SessionGate route={route} />;
}

function Page({ children }: { children: ReactNode }) {
  const loginProblem = loginProblemFrom(location.search);
  return (
    <>
      <Header title="LP-Collection" />
      <main className="content-grid">
        {loginProblem && (
          <p className="notice error" role="alert">
            {loginProblem}
          </p>
        )}
        {children}
      </main>
    </>
  );
}

type Session = { kind: "loading" } | { kind: "unreachable" } | { kind: "signed-out" } | { kind: "signed-in"; me: Me };

function SessionGate({ route }: { route: Exclude<Route, { page: "invite" }> }) {
  const [session, setSession] = useState<Session>({ kind: "loading" });

  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => {
        if (response.status === 401) return setSession({ kind: "signed-out" });
        if (!response.ok) return setSession({ kind: "unreachable" });
        setSession({ kind: "signed-in", me: (await response.json()) as Me });
      })
      .catch(() => setSession({ kind: "unreachable" }));
  }, []);

  switch (session.kind) {
    case "loading":
      return null;
    case "unreachable":
      return (
        <Page>
          <p className="notice error">LP-Collection can't reach its server right now. Try again in a moment.</p>
        </Page>
      );
    case "signed-out":
      return (
        <Page>
          <section className="section">
            <p>LP-Collection is invite only. Ask the app's Owner for an Invite link.</p>
            <p>
              Already a User?{" "}
              <a className="link" href="/api/login">
                Log in with Discogs
              </a>
            </p>
          </section>
        </Page>
      );
    case "signed-in":
      return (
        <>
          {route.page === "lookup" ? (
            <LookupScreen collectionId={session.me.collection.id} />
          ) : route.page === "copy" ? (
            <CopyScreen me={session.me} copyId={route.copyId} />
          ) : (
            <CollectionScreen
              me={session.me}
              onCurrencyChanged={(currency) => setSession({ kind: "signed-in", me: { ...session.me, currency } })}
              onLoggedOut={() => setSession({ kind: "signed-out" })}
            />
          )}
          <Dock current={route.page} />
        </>
      );
  }
}

function Dock({ current }: { current: Route["page"] }) {
  return (
    <nav className="dock content-grid" aria-label="Main">
      <div className="dock-inner">
        <a className="scan" href="/lookup" onClick={followLink} aria-current={current === "lookup" ? "page" : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 9v6M11 9v6M14 9v6M17 9v6" />
          </svg>
          Scan
        </a>
        <a className="tab end" href="/" onClick={followLink} aria-current={current === "collection" || current === "copy" ? "page" : undefined}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <circle cx="12" cy="12" r="3" />
            <circle cx="12" cy="12" r="0.5" fill="currentColor" />
          </svg>
          Collection
        </a>
      </div>
    </nav>
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
      return (
        <Page>
          <p className="notice error">LP-Collection can't reach its server right now. Try again in a moment.</p>
        </Page>
      );
    case "checked":
      if (screen.invite.status === "valid") {
        return (
          <Page>
            <section className="section">
              <div className="section-head">
                <h2>You're invited to LP-Collection</h2>
              </div>
              <p>Log in with your Discogs account to get a Collection of your own.</p>
              <p>
                <a className="btn primary" href={`/api/login?invite=${encodeURIComponent(code)}`}>
                  Log in with Discogs
                </a>
              </p>
            </section>
          </Page>
        );
      }
      return (
        <Page>
          <section className="section">
            <div className="section-head">
              <h2>{refusals[screen.invite.status]}</h2>
            </div>
            <p>LP-Collection is invite only. Ask the app's Owner for a new Invite link.</p>
          </section>
        </Page>
      );
  }
}
