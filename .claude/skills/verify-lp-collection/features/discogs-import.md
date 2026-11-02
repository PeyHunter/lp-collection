# First-login import from Discogs

When a User logs in for the first time, everything already in their Discogs collection is imported once into their own Collection, in the background, with both conditions Very Good Plus. The Collection shows "Importing your Discogs collection… N of M" while it runs and loads again when it is done. Logging in again never imports again.

## Sub-features

- `once`: sign-up records the import (`discogs_imports`), and only a sign-up starts one.
- `paged`: the import lists the Discogs collection 100 items a page across all folders, and remembers the next page, so a restart or a Discogs failure carries on from there. It is tried again after 1 and 5 minutes, then 30 minutes and 2 hours, and the server looks every minute.
- `instance-ids`: each Copy keeps its Discogs folder and instance id, so the Discogs mirror updates that item and never adds it again. An item already imported is skipped.
- `rate-limit`: with the real Discogs the import waits 1.5 s before each request (40 a minute), and a Release it hasn't seen counts as two (Release and master). Each Release is fetched once.
- `progress`: `GET /api/me` answers `discogsImport: { status: "running" | "done", imported, total }`, or null for a User from before imports.

## How to get to it (user POV)

- Log in for the first time with a Discogs account that has records in its collection. The notice sits at the top of the Collection.

## Driving it with verify-lp-collection

Preconditions: baseline state, `doctor.ts` reports `HEALTHY`. The fake Discogs gives a username starting with `with-discogs-collection` 120 records to import, and takes 1.5 s per page so the progress can be seen.

- Log in as `owner` and create an Invite. Through it, log in as `with-discogs-collection-demo`: the notice shows, then the Overview says 120 Copies and the notice is gone.
- Log in again as the same User: still 120 Copies, no notice.
- `node .claude/skills/verify-lp-collection/bin/drive-discogs-import.ts <run-id>` drives all of this and saves `import-running.png`, `import-done.png`, `me-after-import.http.txt` and `console-errors.json` (only the `401` before login is expected).

## Gotchas

- Imported Copies get no Value until the Collection's background Value fetch reaches them (five at a time), like any new Copy.
- `test/api/discogs-import.test.ts` covers an empty collection, a 230-item collection over three pages, a re-login, an interrupted import and the pacing.
