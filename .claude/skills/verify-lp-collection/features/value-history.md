# Value history

Once a month a refresh fetches a new Value for every Copy in every Collection, with each Owner's Discogs account and in the Owner's currency, and records the Collection value. Each refresh is kept, so a Copy's page shows how its Value changed month by month: a list of months, newest first, and a line through them once there are two.

## Sub-features

- `refresh` is `node src/server/main.ts refresh`: one run for the current month (UTC), then it exits. A second run in a finished month does nothing. It paces itself to about 2.4 s per Copy (50 Discogs requests a minute per Owner) with the real Discogs, and not at all with the fake one.
- `resume`: everything a refresh records names it, so a run that stops partway carries on with the Copies and Collections it hasn't done, valuing each Copy once a month.
- `seller-settings` skips a Collection whose Owner has no Discogs seller settings and leaves the month open, so a later run that month tries it again.
- `collection-value` records the Collection value after each Collection, counting Copies with no Value as zero. It isn't shown yet; the home screen (#17) draws it.
- `copy-history` is the "Value history" section on a Copy (`/copies/<id>`), right under Value. It shows only once a refresh has run, only while Values show, and only refreshes in the viewer's currency.
- `cronjob` is `deploy/refresh.yaml`, a Kubernetes CronJob at 03:00 on the 1st of each month using the app image.

## How to get to it (user POV)

- A Copy's page: scroll past Value to "Value history".
- API: `GET /api/collections/<id>/copies/<copyId>` answers `valueHistory: [{ recordedAt, mediaCondition, value }]` next to `copy`, oldest first, while Values show. Other answers about a Copy and lists of Copies don't carry it.

## Driving it with verify-lp-collection

Preconditions: baseline state, `doctor.ts` reports `HEALTHY`. The launcher shares its database and token key with `bin/refresh.ts`, which runs `main.ts refresh` the way the CronJob does.

- Log in as `owner`, save Kind Of Blue (`2474032`), Discovery (`16893476`) and Abbey Road (`13716287`), and open Kind Of Blue: no Value history.
- `node .claude/skills/verify-lp-collection/bin/refresh.ts <run-id>` prints `Refresh <month>: 3 Values fetched, 1 Collection values recorded, month finished.` Reload: Value history lists this month with the Value.
- Run it again: `0 Values fetched`, and the history still has one month.
- Tap "Values": the section goes away.
- `node .claude/skills/verify-lp-collection/bin/drive-value-history.ts <run-id>` drives all of the above and saves `copy-before-refresh.png`, `copy-after-refresh.png`, `copy-values-off.png`, both refresh outputs, `copy-after-refresh.http.txt` and `console-errors.json` (only the `401` before login is expected).

## Gotchas

- A live run can only reach the current month, so it shows one entry and no line. The line is checked in `test/history-chart.test.ts`, and month-over-month history in `test/api/value-history.test.ts`, which moves the test clock.
- The refresh values in the Owner's currency. A Member who chose another currency sees no Value history until they switch back.
- A Copy Discogs fails to value in a refresh has no entry that month and keeps its earlier Value in the Collection value.
