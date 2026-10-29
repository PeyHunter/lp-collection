# Add a Copy by typed barcode

A logged-in User taps Scan, types the barcode from a record's sleeve, and sees the matching Releases from Discogs with cover, artist, title, label, country, year, Catalog number and format. When several Releases match, they tap the pressing they hold. They tap "Add to Collection", land back on their Collection, and see the new Copy with Media condition and Sleeve condition both Very Good Plus. Only Members of a Collection see or add its Copies.

## Sub-features

- `lookup-single` shows "1 Release matches" with the save panel already open.
- `lookup-several` shows "N Releases match", the hint to check the label and year, and opens the save panel under the tapped pressing.
- `lookup-none` says no Release on Discogs has that barcode.
- `lookup-invalid` refuses anything but 8, 12, 13 or 14 digits with "Type all the digits under the barcode: 8, 12 or 13 of them." Spaces and dashes are fine.
- `save-copy` creates a Copy at Very Good Plus for both conditions, returns to the Collection with "Added <title> to your Collection." and the new row tinted.
- `collection-list` lists the Collection's Copies, newest first, with the Original year, label, Catalog number and both conditions. An empty Collection says "No Copies yet." with "Add your first record".
- `release-cache` asks Discogs once per barcode and once per Release. Not visible in the UI; `test/api/add-copy.test.ts` asserts it through the fake's recorded calls.
- `members-only` answers `404` to a User who is not a Member of the Collection.

## How to get to it (user POV)

- Tap "Scan" in the bottom bar, or "Add your first record" on an empty Collection. Both open `/lookup`.
- On `/lookup`, fill "Barcode", tap "Look up", tap a pressing's title, tap "Add to Collection".
- Open `/` (the Collection) or tap "Collection" in the bottom bar.
- API: `GET /api/collections/<id>/lookup?barcode=<digits>`, `POST /api/collections/<id>/copies` with `{"discogsReleaseId": <id>}`, `GET /api/collections/<id>/copies`. The id is `collection.id` from `GET /api/me`.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`. Log in as `owner` on the Fake Discogs page.
- The fake Discogs knows the sample Releases in `src/server/fake-discogs.ts` (`sampleReleases`). Barcode `886979891211` matches three pressings of Miles Davis, Kind Of Blue (2010 US, 2010 Europe, 2015 Europe). `190295328709` matches one, Daft Punk, Discovery (Original year 2001, Pressing year 2021). `4006381333931` matches none.

- **Several matches, pick, save.** Write a Playwright script in the evidence folder with `devices["iPhone 15"]`. Log in as `owner`. Expect "No Copies yet.". Tap the link "Scan", fill the textbox "Barcode" with `886979891211`, tap "Look up". Expect the heading "3 Releases match". In the list item with the text "2010 · Europe · Columbia", tap the button "Kind Of Blue", then "Add to Collection". Expect the status "Added Kind Of Blue to your Collection." and a list item with "Kind Of Blue", "1959 · Columbia · 88697 98912 1" and "Media VG+ · Sleeve VG+".
- **Stored.** Reload. The same list item is still there and the status is gone. Save `curl -s -i -b 'lp_session=<cookie>' <appUrl>/api/collections/<id>/copies` as `copies.http.txt` if you have the cookie from the script's context.
- **No match.** On `/lookup`, look up `4006381333931`. Expect "No Release on Discogs has the barcode 4006381333931."
- **Not a barcode.** Look up `kind of blue`. Expect the alert "Type all the digits under the barcode: 8, 12 or 13 of them."
- **Members only.** Not drivable from the UI, which only ever opens the User's own Collection. `test/api/add-copy.test.ts` covers it. Report `members-only` as covered by tests, not driven.

## Gotchas

- Chromium logs every 4xx answer to a fetch as a console error. The `401` from `/api/me` before login and the `400` from the "not a barcode" Lookup are expected.
- Copies stay in the run's database. A second drive against the same run sees the Copies from the first, so "No Copies yet." only holds on a fresh run or a new username.
- The fake covers are SVGs served by the fake at `/fake-discogs/covers/<id>.svg`. One sample Release has no cover and shows the drawn record.
- A full-page screenshot draws the sticky bottom bar in the middle of the page. Take viewport screenshots, scrolled to what you show.
- The real Discogs search needs a logged-in User's token, so the real Lookup is not drivable here. `test/real-discogs.test.ts` covers the gateway against a local stub.
