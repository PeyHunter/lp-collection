import { followLink } from "./navigation.ts";

export function Header({ kicker, title, back }: { kicker?: string; title: string; back?: string }) {
  return (
    <header className="top content-grid">
      <div className="top-inner">
        {back && (
          <a className="icon-btn" href={back} onClick={followLink} aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </a>
        )}
        <h1>
          {kicker && <small>{kicker}</small>} {title}
        </h1>
      </div>
    </header>
  );
}
