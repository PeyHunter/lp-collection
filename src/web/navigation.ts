import { useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";

export type Route =
  | { page: "collection" }
  | { page: "browse" }
  | { page: "lookup" }
  | { page: "copy"; copyId: string }
  | { page: "shelves" }
  | { page: "shelf"; shelfId: string | null }
  | { page: "fill"; shelfId: string; sectionId: string }
  | { page: "invite"; code: string };

export type Handoff = { kind: "saved"; copyId: string; title: string } | { kind: "deleted"; title: string } | null;

function routeFrom(pathname: string): Route {
  const invite = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  if (invite) return { page: "invite", code: decodeURIComponent(invite[1]!) };
  if (/^\/lookup\/?$/.test(pathname)) return { page: "lookup" };
  if (/^\/browse\/?$/.test(pathname)) return { page: "browse" };
  const copy = /^\/copies\/([^/]+)\/?$/.exec(pathname);
  if (copy) return { page: "copy", copyId: decodeURIComponent(copy[1]!) };
  if (/^\/shelves\/?$/.test(pathname)) return { page: "shelves" };
  if (/^\/shelves\/new\/?$/.test(pathname)) return { page: "shelf", shelfId: null };
  const fill = /^\/shelves\/([^/]+)\/sections\/([^/]+)\/?$/.exec(pathname);
  if (fill) return { page: "fill", shelfId: decodeURIComponent(fill[1]!), sectionId: decodeURIComponent(fill[2]!) };
  const shelf = /^\/shelves\/([^/]+)\/?$/.exec(pathname);
  if (shelf) return { page: "shelf", shelfId: decodeURIComponent(shelf[1]!) };
  return { page: "collection" };
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    removeEventListener("popstate", listener);
  };
}

export function useRoute() {
  return routeFrom(useSyncExternalStore(subscribe, () => location.pathname));
}

/** Every page the app opens itself is marked, so its Back can return to the page before it. */
type EntryState = { handoff: Handoff; inApp: true } | null;

/** Shows the handoff once: a reload or a return through history no longer carries it. */
export function useHandoff() {
  const [handoff] = useState(() => (history.state as EntryState)?.handoff ?? null);
  useEffect(() => {
    const state = history.state as EntryState;
    history.replaceState(state && { ...state, handoff: null }, "");
  }, []);
  return handoff;
}

export function navigate(path: string, handoff: Handoff = null) {
  history.pushState({ handoff, inApp: true } satisfies EntryState, "", path);
  scrollTo({ top: 0 });
  for (const listener of listeners) listener();
}

export function followLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.pathname + event.currentTarget.search);
}

/** Back to the page this one was opened from, as it was left, or to the link's page when the app was opened here. */
export function followBack(event: MouseEvent<HTMLAnchorElement>) {
  if (!(history.state as EntryState)?.inApp || event.defaultPrevented || event.button !== 0) return followLink(event);
  event.preventDefault();
  history.back();
}
