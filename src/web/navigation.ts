import { useSyncExternalStore, type MouseEvent } from "react";

export type Route = { page: "collection" } | { page: "lookup" } | { page: "invite"; code: string };

/** What one screen hands the next when it navigates, such as the Copy just saved. */
export type Handoff = { savedCopyId: string; title: string } | null;

function routeFrom(pathname: string): Route {
  const invite = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  if (invite) return { page: "invite", code: decodeURIComponent(invite[1]!) };
  if (/^\/lookup\/?$/.test(pathname)) return { page: "lookup" };
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

/** The handoff stays in history.state, so a reload would show it again; the reader clears it once shown. */
export function readHandoff() {
  return history.state as Handoff;
}

export function clearHandoff() {
  history.replaceState(null, "");
}

export function navigate(path: string, handoff: Handoff = null) {
  history.pushState(handoff, "", path);
  scrollTo({ top: 0 });
  for (const listener of listeners) listener();
}

/** Lets a plain link navigate inside the app, while a modified click still opens a new tab. */
export function followLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.pathname);
}
