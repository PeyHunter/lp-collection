# Search, sort and filter

The Collection list has one search box, sort chips with a button that reverses the order, and Period and genre chips. Search, sort and filters combine. Copies sit under poster group headings that say how many Copies each group has, and the next 50 load as the User scrolls. Each row shows the Original year and the Pressing year. Value high first is the default, and Copies with no Value come last in both directions.

## Sub-features

- `search` matches artist, title, label, Catalog number, genre and style, in any case. Every word must match. A Catalog number also matches without its spaces or dashes ("kab1" finds "KAB 1").
- `sort` offers Value, Artist, Period, Year (Original year) and Added. Each has a default direction: Value high first, Artist A to Z, Period and Year oldest first, Added newest first. The arrows button reverses it, and the note under the chips says the order ("Low first. Copies with no Value always come last.").
- `no-value-last` puts Copies with no Value in their own last group, "No Value yet", whichever way Value sorts. When the seller settings are missing, that group says "Waits for seller settings".
- `groups` heads each group with a poster line: Value bands ("500+ kr", "Under 10 kr"), the artist's first letter ("B" for The Beatles, since a leading "The" is ignored), the year, the Period ("The 70s"), or the month added. "Year unknown" holds Copies without an Original year.
- `filters` show the Collection's Periods and genres with counts, as chips with "Any period" and "Any genre". They combine with each other, the search and the sort.
- `years` shows "1969 · pressed 2019 · Apple Records · PCS 7088" on each row.
- `pages` loads 50 Copies, then the next 50 when the "Show more (N left)" button scrolls near view. Tapping it also loads more.
- `address` keeps the search, sort and filters in the address (`/?sort=artist&genre=Rock`), so a reload or going back from a Copy shows the same view.
- `genres-backfill` gives genres to Releases saved before genres were kept, during the background Value fetch.

## How to get to it (user POV)

- Collection (`/`): the controls sit under "The records". The groups follow.
- API: `GET /api/collections/<id>/copies` with `q`, `sort` (`value`, `artist`, `year`, `period`, `added`), `dir` (`asc`, `desc`), `period` (a decade, as in `1970`), `genre`, `limit` (1 to 100, default 50) and `cursor` (the `next` of the page before). The answer has `copies`, `total`, `groups` (`key`, `total` across every page, `length` on this page), `next`, and on the first page `facets` (`periods`, `genres`). An unknown value answers `400`. A User who is not a Member gets `404`.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`.
- The fake Discogs knows these Releases by barcode: Gas 5 (`5099969209017`, no Value), the Kind Of Blue pressings (`886979891211`, pick "Sony Music" or "CS 8163"), Discovery (`190295328709`), Abbey Road (`602577915062`), Hounds Of Love (`5099924015813`) and Trans-Europe Express (`5099906406616`).

- **Sorts.** Log in as `owner` and add the seven Copies above. Expect the groups "500+ kr", "200+ kr", "100+ kr" and "No Value yet", with Trans-Europe Express first (615 kr) and Gas 5 last. Tap "Reverse the order": Gas 5 stays last. Tap "Period": "The 50s", "The 60s", "The 70s", "The 80s", "The 00s".
- **Search.** Type "miles": two Kind Of Blue rows and "2 LPs found". Type "kab1": Hounds Of Love.
- **Filters.** Clear the search, tap "Electronic" and then "70s": only Trans-Europe Express. Reload: the same view. Add "Jazz": "No Copies match in the 70s in Jazz." and "Show every Copy".
- **Pages.** Save 60 more Copies through the API, open `/?sort=added`, and scroll to the end: 67 rows, and the "Show more" button is gone.
- `node .claude/skills/verify-lp-collection/bin/drive-search-sort.ts <run-id>` drives all of the above on a fresh run and saves `sort-value-high.png`, `sort-value-low.png`, `sort-period.png`, `search-miles.png`, `filters-combined.png`, `no-match.png`, `more-loaded.png`, `search-sort.http.txt` and `console-errors.json` in `.verify/<run-id>/evidence/`.
- `node scripts/perf/collection-5000.ts` seeds five Collections of 5,000 Copies and prints the list's latency and query plans.

## Gotchas

- A Copy valued in the background keeps its place until the list loads again, so the list does not jump under the User's finger.
- Group totals count the whole result, so a group split across two pages shows the same total on both.
- PostgreSQL puts its socket lock file in `/tmp` whatever `TMPDIR` says. When `/tmp` is full, the launcher fails with `app exited early`.
