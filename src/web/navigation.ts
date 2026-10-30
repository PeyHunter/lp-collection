import { useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";

export type Route = { page: "collection" } | { page: "lookup" } | { page: "copy"; copyId: string } | { page: "invite"; code: string };

export type Handoff = { savedCopyId: string; title: string } | null;

function routeFrom(pathname: string): Route {
  const invite = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  if (invite) return { page: "invite", code: decodeURIComponent(invite[1]!) };
  if (/^\/lookup\/?$/.test(pathname)) return { page: "lookup" };
  const copy = /^\/copies\/([^/]+)\/?$/.exec(pathname);
  if (copy) return { page: "copy", copyId: decodeURIComponent(copy[1]!) };
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

/** Shows the handoff once: a reload or a return through history no longer carries it. */
export function useHandoff() {
  const [handoff] = useState(() => history.state as Handoff);
  useEffect(() => history.replaceState(null, ""), []);
  return handoff;
}

export function navigate(path: string, handoff: Handoff = null) {
  history.pushState(handoff, "", path);
  scrollTo({ top: 0 });
  for (const listener of listeners) listener();
}

export function followLink(event: MouseEvent<HTMLAnchorElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.pathname);
}
