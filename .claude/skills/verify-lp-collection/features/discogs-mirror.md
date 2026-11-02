# Discogs mirror

Every add, change and delete of a Copy is mirrored one way into the Owner's Discogs collection (ADR-0002), with the Owner's Discogs account whoever made the change. Adding a Copy adds its Release to the Owner's Discogs collection (folder Uncategorized) with both conditions and the note; changing the conditions or the note updates that item; deleting the Copy removes it. A Discogs failure never blocks the change in the app: the Copy shows "Not synced to Discogs yet" until a later try succeeds.

## Sub-features

- `add` stores the Discogs folder and instance id on the Copy, then sets Media condition, Sleeve condition and Notes on the item.
- `update` follows a change to either condition or the note. Purchase price, purchase date, Section and Photos stay in the app.
- `remove` takes the item out of the Owner's Discogs collection. A Copy deleted before it ever reached Discogs is never sent.
- `retry`: each change is a job in the database (`mirror_jobs`), tried at once in the background and again after 1 and 5 minutes, then 30 minutes, 2 and 6 hours. The server retries due jobs every minute and at start.
- `rate-limit` keeps the mirror to 40 Discogs calls a minute per Owner, under Discogs' 60, and the real gateway already spaces every request a second apart. Jobs over the budget wait for the next minute.
- `marker`: "Not synced to Discogs yet" on a Collection row and on the Copy page while the Copy has a job waiting.

## How to get to it (user POV)

- Add, change or delete a Copy anywhere in the app; nothing extra to tap.
- API: list answers carry `notSyncedYet: [copyId]` for the Copies on the page; a Copy answer (GET, POST, PATCH) carries `notSyncedYet: true|false` next to `copy`.

## Driving it with verify-lp-collection

Preconditions: baseline state, `doctor.ts` reports `HEALTHY`. The fake Discogs refuses every collection change for usernames starting with `no-collection-sync`.

- Log in as `owner` and save two Copies: the list soon answers `notSyncedYet: []` and no row has a marker.
- Log in through an Invite as `no-collection-sync-demo` and save Kind Of Blue: the Copy is saved, its row and its page say "Not synced to Discogs yet".
- `node .claude/skills/verify-lp-collection/bin/drive-discogs-mirror.ts <run-id>` drives both and saves `synced-collection.png`, `not-synced-row.png`, `not-synced-copy.png`, the list answers and `console-errors.json` (only the `401` before login is expected).

## Gotchas

- The live run can't show what the fake Discogs collection holds. `test/api/discogs-mirror.test.ts` asserts on it through `collectionOf`, and `test/real-discogs.test.ts` checks the real HTTP calls.
- Changes made on the Discogs website are never pulled back (ADR-0002).
