import { useEffect, useState, type ReactNode } from "react";
import type { Facets } from "../server/listing.ts";
import { sortOptions, type ListQuery } from "./copy-list.ts";

export function periodName(period: number) {
  return `${String(period).slice(2)}s`;
}

export function ListControls({ query, facets, onChange }: { query: ListQuery; facets: Facets; onChange: (query: ListQuery) => void }) {
  const [typed, setTyped] = useState(query.q);
  const sort = sortOptions.find((option) => option.sort === query.sort)!;

  useEffect(() => {
    if (typed === query.q) return;
    const settle = setTimeout(() => onChange({ ...query, q: typed }), 250);
    return () => clearTimeout(settle);
  }, [typed, query, onChange]);

  return (
    <section className="controls" aria-label="Search, sort and filter">
      <label className="search">
        <span className="visually-hidden">Search the Collection</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          className="input"
          type="search"
          placeholder="Search artist, title, label, genre…"
          autoComplete="off"
          enterKeyHint="search"
          value={typed}
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
      </label>

      <fieldset className="sort">
        <legend className="visually-hidden">Sort by</legend>
        <div className="chip-row">
          {sortOptions.map((option) => (
            <label className="chip" key={option.sort}>
              <input type="radio" name="sort" checked={query.sort === option.sort} onChange={() => onChange({ ...query, sort: option.sort, dir: option.dir })} />
              {option.label}
            </label>
          ))}
        </div>
        <button className="dir" type="button" aria-label={`Reverse the order: ${sort.order[query.dir]}`} onClick={() => onChange({ ...query, dir: query.dir === "asc" ? "desc" : "asc" })}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 4v16M4 16l4 4 4-4M16 20V4M12 8l4-4 4 4" />
          </svg>
        </button>
      </fieldset>
      <p className="order-note" aria-live="polite">
        {sort.order[query.dir]}
        {query.sort === "value" ? ". Copies with no Value always come last." : "."}
      </p>

      {facets.periods.length > 1 && (
        <FilterChips legend="Period" anyLabel="Any period" chosen={query.period} onChoose={(period) => onChange({ ...query, period })}>
          {facets.periods.map(({ period, count }) => ({ value: period, label: periodName(period), count }))}
        </FilterChips>
      )}
      {facets.genres.length > 1 && (
        <FilterChips legend="Genre" anyLabel="Any genre" chosen={query.genre} onChoose={(genre) => onChange({ ...query, genre })}>
          {facets.genres.map(({ genre, count }) => ({ value: genre, label: genre, count }))}
        </FilterChips>
      )}
    </section>
  );
}

function FilterChips<Value extends string | number>({
  legend,
  anyLabel,
  chosen,
  onChoose,
  children,
}: {
  legend: string;
  anyLabel: string;
  chosen: Value | null;
  onChoose: (value: Value | null) => void;
  children: { value: Value; label: ReactNode; count: number }[];
}) {
  const name = `filter-${legend.toLowerCase()}`;
  return (
    <fieldset className="filter">
      <legend>{legend}</legend>
      <div className="chip-row">
        <label className="chip">
          <input type="radio" name={name} checked={chosen === null} onChange={() => onChoose(null)} />
          {anyLabel}
        </label>
        {children.map(({ value, label, count }) => (
          <label className="chip" key={value}>
            <input type="radio" name={name} checked={chosen === value} onChange={() => onChoose(value)} />
            {label} <span className="chip-count tnum">{count}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
