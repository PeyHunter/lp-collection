import type { ReactNode } from "react";
import { followBack, followLink } from "./navigation.ts";

/** `backThroughHistory` returns to whichever page opened this one, where it was left, rather than always to `back`. */
export function Header({ kicker, title, back, backThroughHistory = false, end }: { kicker?: string; title: string; back?: string; backThroughHistory?: boolean; end?: ReactNode }) {
  return (
    <header className="top content-grid">
      <div className="top-inner">
        {back && (
          <a className="icon-btn" href={back} onClick={backThroughHistory ? followBack : followLink} aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </a>
        )}
        <h1>
          {kicker && <small>{kicker}</small>} {title}
        </h1>
        {end}
      </div>
    </header>
  );
}
