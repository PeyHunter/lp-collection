# Add a Copy by typed barcode, Catalog number, or artist and title

A logged-in User taps Scan, types the barcode from a record's sleeve, and sees the matching Releases from Discogs with cover, artist, title, label, country, year, Catalog number and format. When several Releases match, they tap the pressing they hold. They tap "Add to Collection", land back on their Collection, and see the new Copy with Media condition and Sleeve condition both Very Good Plus. Only Members of a Collection see or add its Copies.

When the barcode finds nothing, the screen offers "Search by Catalog number". When that finds nothing, it offers "Search by artist and title". The chips "Barcode", "Catalog number" and "Artist and title" above the field pick a way directly. Every way ends in the same pick list. A candidate the Collection already has a Copy of carries "In your Collection", and picking it shows "You already have N Copy/Copies of this. Add another?" with "Add another" and "Cancel".

## Sub-features

- `lookup-single` shows "1 Release matches" with the save panel already open.
- `lookup-several` shows "N Releases match", the hint to check the label and year, and opens the save panel under the tapped pressing.
- `lookup-none` says no Release on Discogs has that barcode and offers "Search by Catalog number".
- `lookup-catalog-number` looks up by Catalog number, ignoring case and extra spaces. No match offers "Search by artist and title". A list also offers it under "Not the one you hold?".
- `lookup-artist-title` looks up by artist, title, or both. No match says "Nothing on Discogs matches …" with no further way.
- `lookup-first-page` shows at most 25 candidates. When more matched, the heading gives the total and the lead says "Showing the first 25." Covered by `test/api/lookup-fallbacks.test.ts`; the fake knows too few Releases to show it.
- `duplicate-warning` marks candidates the Collection has with "In your Collection". Picking one shows "You already have 1 Copy of this. Add another?" (or "2 Copies"). "Cancel" closes the panel and saves nothing; "Add another" saves one more Copy.
- `lookup-invalid` refuses anything but 8, 12, 13 or 14 digits with "Type all the digits under the barcode: 8, 12, 13 or 14 of them." Spaces and dashes are fine.
- `save-copy` creates a Copy at Very Good Plus for both conditions, returns to the Collection with "Added <title> to your Collection." and the new row tinted.
- `collection-list` lists the Collection's Copies, newest first, with the Original year, label, Catalog number and both conditions. An empty Collection says "No Copies yet." with "Add your first record".
- `release-cache` asks Discogs once per barcode and once per Release. Not visible in the UI; `test/api/add-copy.test.ts` asserts it through the fake's recorded calls.
- `members-only` answers `404` to a User who is not a Member of the Collection.

## How to get to it (user POV)

- Tap "Scan" in the bottom bar, or "Add your first record" on an empty Collection. Both open `/lookup`.
- On `/lookup`, fill "Barcode", tap "Look up", tap a pressing's title, tap "Add to Collection".
- Open `/` (the Collection) or tap "Collection" in the bottom bar.
- On `/lookup`, tap the chip "Catalog number" or "Artist and title", or the offer under a Lookup that found nothing.
- API: `GET /api/collections/<id>/lookup?barcode=<digits>` or `?catalogNumber=<text>` or `?artist=<text>&title=<text>` (one way per request; each candidate has `copiesInCollection`, the body has `total`), `POST /api/collections/<id>/copies` with `{"discogsReleaseId": <id>}`, `GET /api/collections/<id>/copies`. The id is `collection.id` from `GET /api/me`.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`. Log in as `owner` on the Fake Discogs page.
- The fake Discogs knows the sample Releases in `src/server/fake-discogs.ts` (`sampleReleases`). Barcode `886979891211` matches three pressings of Miles Davis, Kind Of Blue (2010 US, 2010 Europe, 2015 Europe). `190295328709` matches one, Daft Punk, Discovery (Original year 2001, Pressing year 2021). `4006381333931` matches none. Two pressings of The Beatles, Sgt. Pepper's Lonely Hearts Club Band have no barcode: `PCS 7027` (1967 UK, Parlophone) and `SHZE 401` (1967 Germany, Odeon, no cover). `PCS 7099` matches none.

- **Fallbacks and the duplicate warning.** On a fresh run, `node .claude/skills/verify-lp-collection/bin/drive-lookup-fallbacks.ts <run-id>` logs in as `owner` and walks barcode miss, Catalog number miss, artist and title hit, save, the warning with 1 Copy, Cancel, Add another, reload, and the warning with 2 Copies. It saves numbered screenshots, `lookup-catalog-number.http.txt`, and `console-errors.txt`, where only the `401` before login is expected. It fails on the first step that doesn't show what it expects.

- **Several matches, pick, save.** Write a Playwright script in the evidence folder with `devices["iPhone 15"]`. Log in as `owner`. Expect "No Copies yet.". Tap the link "Scan", fill the textbox "Barcode" with `886979891211`, tap "Look up". Expect the heading "3 Releases match". In the list item with the text "2010 · Europe · Columbia", tap the button "Kind Of Blue", then "Add to Collection". Expect the status "Added Kind Of Blue to your Collection." and a list item with "Kind Of Blue", "1959 · Columbia · 88697 98912 1" and "Media VG+ · Sleeve VG+".
- **Stored.** Reload. The same list item is still there and the status is gone. Save `curl -s -i -b 'lp_session=<cookie>' <appUrl>/api/collections/<id>/copies` as `copies.http.txt` if you have the cookie from the script's context.
- **No match.** On `/lookup`, look up `4006381333931`. Expect "No Release on Discogs has the barcode 4006381333931." and the button "Search by Catalog number".
- **Not a barcode.** Look up `kind of blue`. Expect the alert "Type all the digits under the barcode: 8, 12, 13 or 14 of them."
- **Members only.** Not drivable from the UI, which only ever opens the User's own Collection. `test/api/add-copy.test.ts` covers it. Report `members-only` as covered by tests, not driven.

## Gotchas

- Chromium logs every 4xx answer to a fetch as a console error. The `401` from `/api/me` before login and the `400` from the "not a barcode" Lookup are expected.
- Copies stay in the run's database. A second drive against the same run sees the Copies from the first, so "No Copies yet." only holds on a fresh run or a new username.
- The fake covers are SVGs served by the fake at `/fake-discogs/covers/<id>.svg`. One sample Release has no cover and shows the drawn record.
- A full-page screenshot draws the sticky bottom bar in the middle of the page. Take viewport screenshots, scrolled to what you show.
- The real Discogs search needs a logged-in User's token, so the real Lookup is not drivable here. `test/real-discogs.test.ts` covers the gateway against a local stub.
- `/lookup` also starts the camera. Without a fake camera the screen shows "The camera didn't start." above the typed field, which does not affect typing. [scan.md](./scan.md) covers the camera.
