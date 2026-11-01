# Browse covers

"Browse covers" on the Collection opens the Copies as big covers, one at a time, in the order and with the search and filters of the list it came from. Swiping left or right flips to the next or previous cover, like a record crate, and tapping a cover opens the Copy. Back from that Copy lands on the same cover. Each cover is the Copy's own first Photo, or the Discogs cover without one. The Value shows under it while Values show.

## Sub-features

- `entry` is a "Browse covers" link under the list controls on `/`, carrying the list's search, sort and filters to `/browse?…`.
- `swipe`: the covers sit in a sideways scroller with scroll snapping, so a swipe always stops on one cover. "Previous" and "Next" buttons do the same for anyone not swiping. A status reads "N of M: Title".
- `return`: the cover in view is kept in the address (`at=`), and the Copy page's Back returns to the page that opened it, so Back from a Copy lands on the same cover. The Collection list keeps its filters the same way.
- `lazy`: only covers within two of the one in view load, and the next page of 50 Copies loads five covers before the end.
- `values-off` hides the Value under each cover.

## How to get to it (user POV)

- Collection (`/`): tap "Browse covers" under the sort and filters.
- Open `/browse` directly, optionally with the list's query (`?sort=artist`, `q=…`, `period=…`, `genre=…`, `shelf=none`).

## Driving it with verify-lp-collection

Preconditions: baseline state, `doctor.ts` reports `HEALTHY`.

- Log in as `owner` and save five sample Releases. Open `/?sort=artist` and tap "Browse covers": "1 of 5: Abbey Road".
- Swipe left twice (3 of 5), right once (2 of 5). Tap the cover, then Back: "2 of 5" again, with `at=1` in the address.
- Tap "Values": no amounts under the covers.
- `node .claude/skills/verify-lp-collection/bin/drive-browse.ts <run-id>` drives all of the above and saves `browse-first.png`, `browse-third.png`, `browse-values-off.png` and `console-errors.json` (only the `401` before login is expected).

## Gotchas

- Headless Chromium ignores touch-sourced scroll gestures, so the scripts swipe with `Input.synthesizeScrollGesture` from the default source, which scrolls and snaps the same way. Wait for the crate to stop before the next swipe or a screenshot, or it is caught mid-snap.
- `e2e/browse.spec.ts` covers paging with 55 Copies (the live recipe uses five).
