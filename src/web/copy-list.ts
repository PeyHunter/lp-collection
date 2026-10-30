import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { CopyView } from "../server/collection.ts";
import type { Direction, Facets, ListGroup, SortName } from "../server/listing.ts";
import { fetchValues } from "./Value.tsx";

export type ListQuery = { q: string; sort: SortName; dir: Direction; period: number | null; genre: string | null };

export const sortOptions: { sort: SortName; label: string; dir: Direction; order: Record<Direction, string> }[] = [
  { sort: "value", label: "Value", dir: "desc", order: { desc: "High first", asc: "Low first" } },
  { sort: "artist", label: "Artist", dir: "asc", order: { asc: "A to Z", desc: "Z to A" } },
  { sort: "period", label: "Period", dir: "asc", order: { asc: "Oldest first", desc: "Newest first" } },
  { sort: "year", label: "Year", dir: "asc", order: { asc: "Oldest first", desc: "Newest first" } },
  { sort: "added", label: "Added", dir: "desc", order: { desc: "Newest first", asc: "Oldest first" } },
];

const defaultSort = sortOptions[0]!;

/** The list's search, sort and filters live in the address, so going back from a Copy returns to the same view. */
export function queryFromSearch(search: string): ListQuery {
  const params = new URLSearchParams(search);
  const option = sortOptions.find((candidate) => candidate.sort === params.get("sort")) ?? defaultSort;
  const dir = params.get("dir");
  const period = params.get("period");
  return {
    q: params.get("q") ?? "",
    sort: option.sort,
    dir: dir === "asc" || dir === "desc" ? dir : option.dir,
    period: period && /^\d{3}0$/.test(period) ? Number(period) : null,
    genre: params.get("genre") || null,
  };
}

export function searchFromQuery(query: ListQuery, { forApi = false } = {}) {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q.trim());
  if (forApi || query.sort !== defaultSort.sort) params.set("sort", query.sort);
  if (forApi || query.dir !== sortOptions.find((option) => option.sort === query.sort)!.dir) params.set("dir", query.dir);
  if (query.period !== null) params.set("period", String(query.period));
  if (query.genre !== null) params.set("genre", query.genre);
  return params.toString();
}

type Page = { copies: CopyView[]; groups: ListGroup[]; total: number; next: string | null; facets: Facets | null; sellerSettingsMissing: boolean };

export type CopyList =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; copies: CopyView[]; groups: ListGroup[]; total: number; next: string | null; facets: Facets; more: "idle" | "loading" | "failed"; sellerSettingsMissing: boolean };

type Action = { type: "load" } | { type: "failed" } | { type: "first-page"; page: Page } | { type: "more" } | { type: "more-failed" } | { type: "next-page"; page: Page };

function appendGroups(groups: ListGroup[], next: ListGroup[]) {
  const [first, ...rest] = next;
  const last = groups.at(-1);
  if (!first) return groups;
  if (last?.key !== first.key) return [...groups, ...next];
  return [...groups.slice(0, -1), { ...last, length: last.length + first.length, total: first.total }, ...rest];
}

function reduce(state: CopyList, action: Action): CopyList {
  switch (action.type) {
    case "load":
      return state.kind === "loaded" ? state : { kind: "loading" };
    case "failed":
      return { kind: "failed" };
    case "first-page":
      return { kind: "loaded", ...action.page, facets: action.page.facets ?? { periods: [], genres: [] }, more: "idle" };
    case "more":
      return state.kind === "loaded" ? { ...state, more: "loading" } : state;
    case "more-failed":
      return state.kind === "loaded" ? { ...state, more: "failed" } : state;
    case "next-page": {
      if (state.kind !== "loaded") return state;
      const known = new Set(state.copies.map((copy) => copy.id));
      const fresh = action.page.copies.filter((copy) => !known.has(copy.id));
      return { ...state, copies: [...state.copies, ...fresh], groups: appendGroups(state.groups, action.page.groups), next: action.page.next, more: "idle" };
    }
  }
}

async function fetchPage(collectionId: string, query: ListQuery, cursor: string | null, signal: AbortSignal) {
  const params = new URLSearchParams(searchFromQuery(query, { forApi: true }));
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/collections/${collectionId}/copies?${params}`, { signal }).catch(() => undefined);
  return response?.ok ? ((await response.json()) as Page) : undefined;
}

type Values = { fetching: boolean; sellerSettingsMissing: boolean | undefined; valued: Map<string, CopyView> };

/**
 * One page of the Collection for the search, sort and filters, more pages on request, and Values fetched in the
 * background for every Copy that has none. A Copy valued while the list is open keeps its place until the next load.
 */
export function useCopyList(collectionId: string, query: ListQuery, reloadKey: string) {
  const [list, dispatch] = useReducer(reduce, { kind: "loading" });
  const [values, setValues] = useState<Values>({ fetching: true, sellerSettingsMissing: undefined, valued: new Map() });
  const moreAbort = useRef<AbortController | null>(null);
  const apiQuery = searchFromQuery(query, { forApi: true });
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    moreAbort.current?.abort();
    const abort = new AbortController();
    dispatch({ type: "load" });
    fetchPage(collectionId, queryRef.current, null, abort.signal).then((page) => {
      if (!abort.signal.aborted) dispatch(page ? { type: "first-page", page } : { type: "failed" });
    });
    return () => abort.abort();
  }, [collectionId, apiQuery, reloadKey]);

  useEffect(() => {
    const abort = new AbortController();
    setValues({ fetching: true, sellerSettingsMissing: undefined, valued: new Map() });
    fetchValues(collectionId, {
      signal: abort.signal,
      onBatch: ({ copies, sellerSettingsMissing, more }) =>
        setValues((before) => ({
          fetching: more && !sellerSettingsMissing,
          sellerSettingsMissing,
          valued: new Map([...before.valued, ...copies.map((copy) => [copy.id, copy] as const)]),
        })),
    }).then(() => {
      if (!abort.signal.aborted) setValues((before) => ({ ...before, fetching: false }));
    });
    return () => abort.abort();
  }, [collectionId, reloadKey]);

  const loadMore = useCallback(async () => {
    if (list.kind !== "loaded" || !list.next || list.more === "loading") return;
    const abort = new AbortController();
    moreAbort.current = abort;
    dispatch({ type: "more" });
    const page = await fetchPage(collectionId, queryRef.current, list.next, abort.signal);
    if (!abort.signal.aborted) dispatch(page ? { type: "next-page", page } : { type: "more-failed" });
  }, [collectionId, list]);

  if (list.kind !== "loaded") return { list, values, loadMore };
  return {
    list: { ...list, copies: list.copies.map((copy) => values.valued.get(copy.id) ?? copy), sellerSettingsMissing: values.sellerSettingsMissing ?? list.sellerSettingsMissing },
    values,
    loadMore,
  };
}
