# Overview

The top of the Collection (`/`), the first thing the app shows, is the big picture: the Collection value, the number of Copies, a graph of the Collection value at each monthly refresh, and the ten most valuable Copies, each linking to its Copy. The dock's big Scan button starts the camera Lookup. With Values hidden it is only the number of Copies.

## Sub-features

- `figures`: "Collection value" in the User's currency (Copies with no Value count as zero) and "N Copies".
- `graph` draws the Collection value from the Value history (one point per monthly refresh in the User's currency) once there are two. Until then a hint says when it starts.
- `most-valuable` is a "Most valuable" list of up to ten Copies with a Value, highest first, each a link to `/copies/<id>`.
- `scan` is the dock's "Scan" link to `/lookup`, which starts the camera.
- `values-off` leaves only the number of Copies.

## How to get to it (user POV)

- Open the app, or tap "Collection" in the dock. The overview sits above "The records".
- API: `GET /api/collections/<id>/overview` answers `{ copies, collectionValue: { amount, currency }, mostValuable: [Copy], history: [{ recordedAt, value }] }`, or only `{ copies }` while Values are hidden. No session answers `401`, and another Collection `404`.

## Driving it with verify-lp-collection

Preconditions: baseline state, `doctor.ts` reports `HEALTHY`.

- Log in as `owner`: the overview says 0 Copies.
- Save seven sample Releases and reload: the Collection value, "7 Copies", and Most valuable led by Trans-Europe Express. Tap it: its Copy opens.
- Tap "Values": the overview shows only the number of Copies.
- Tap the dock's "Scan": `/lookup` opens.
- `node .claude/skills/verify-lp-collection/bin/drive-overview.ts <run-id>` drives all of the above and saves `overview-empty.png`, `overview.png`, `overview-values-off.png`, both `overview*.http.txt` answers and `console-errors.json` (only the `401` before login is expected).

## Gotchas

- A live run reaches only the current month, so it can't draw the graph. `test/api/overview.test.ts` checks the history across two months, and `test/history-chart.test.ts` checks the line.
- The Collection value is live (the latest Value of each Copy). The graph is the monthly record, so the two can differ until the next refresh.
- The page now has two lists of Copies. In tests, find Collection rows inside `region "Copies"`.
