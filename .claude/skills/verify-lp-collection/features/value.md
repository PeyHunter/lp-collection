# Value

Every Copy shows its Value, the Discogs suggested price for its Media condition, in the User's currency (DKK unless they chose another), with the Lowest listing as a smaller number. A row in the Collection opens the Copy page, where Media condition and Sleeve condition can be changed. Changing the Media condition fetches the new Value at once. A Release with no price suggestion shows "No Value yet". A User whose Discogs seller settings are missing sees one guide with a link to fill them in, not "No Value yet" on every Copy.

## Sub-features

- `row-value` shows the Value at the end of each Collection row, as in "252 kr", or "No Value yet". A Copy with no Value stays in the list.
- `copy-page` at `/copies/<id>` shows the cover, title, artist, Release facts, the Value "for VG+", the Lowest listing ("Lowest listing 231 kr, any condition"), and the two condition pickers.
- `condition-change` saves a new Media condition, fetches its Value, and stores a new ValueSnapshot. A Sleeve condition change alone asks Discogs nothing. Sleeve condition also takes Generic, Not Graded and No Cover.
- `no-value` shows "No Value yet" when Discogs has no price suggestion. The Lowest listing can still show.
- `seller-settings-guide` replaces "No Value yet" with one guide, "Fill in your Discogs seller settings to see Values", on the Collection and the Copy page. Rows say "Waits for seller settings". "I've saved them, fetch Values" fetches Values for every Copy without one.
- `currency` is a picker in the Account section. Values fetched afterwards use it. Earlier snapshots keep their own currency.
- `value-snapshots` keeps every fetch. Not visible in the UI yet; `test/api/value.test.ts` reads the `value_snapshots` table.
- `members-only` answers `404` to a User who is not a Member.

## How to get to it (user POV)

- Collection (`/`): each row ends with the Value. Tap a row to open the Copy page.
- Copy page (`/copies/<id>`): the Value section and the Condition section. The back button returns to the Collection.
- Account section at the bottom of the Collection: "Currency".
- API: `GET /api/collections/<id>/copies`, `GET` and `PATCH /api/collections/<id>/copies/<copyId>` with `{"mediaCondition": "..."}` or `{"sleeveCondition": "..."}`, `POST /api/collections/<id>/values`, `PUT /api/me/currency` with `{"currency": "EUR"}`. Copy answers carry `sellerSettingsMissing`. `GET /api/me` has `currency` and `sellerSettingsUrl`.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`.
- The fake Discogs quotes prices in euros (`samplePrices` in `src/server/fake-discogs.ts`) and the fixed rates turn 1 EUR into 7.46 DKK. Discovery (`190295328709`) is 252 kr at VG+ and 336 kr at Near Mint, with a Lowest listing of 231 kr. Kind Of Blue, 2015 Sony Music (`886979891211`, the "Sony Music" pressing) is 134 kr at VG+. Gas 5 (`5099969209017`) has no price suggestion and a Lowest listing of 90 kr.
- The username `no-seller-settings` has no seller settings until it saves them on the fake page `/fake-discogs/settings/seller`. It needs an Invite from `owner`.

- **Values in the list.** Log in as `owner`. Add Gas 5, the Sony Kind Of Blue and Discovery by barcode. Expect rows ending in "252 kr", "134 kr" and "No Value yet".
- **Copy page and condition change.** Tap "Discovery". Expect the region "Value" with "252 kr" and "Lowest listing 231 kr, any condition". Select "Near Mint (NM or M-)" in "Media condition". Expect "336 kr" and "for NM or M-". Select "No Cover" in "Sleeve condition". Reload: both stay.
- **Seller settings guide.** As `owner`, tap "Create Invite". In a new context open the link and log in as `no-seller-settings`. Add Discovery. Expect the region "Fill in your Discogs seller settings to see Values", no "No Value yet", and "Waits for seller settings" on the row. Tap "Open seller settings on Discogs" (opens a new tab), fill "Discogs username" with `no-seller-settings`, tap "Save seller settings". Back in the app, tap "I've saved them, fetch Values". Expect the guide gone and "252 kr".
- **Currency.** Select "EUR" in "Currency", add Discovery again. Expect "34 €" on the new row.
- `node .claude/skills/verify-lp-collection/bin/drive-value.ts <run-id>` drives all of the above on a fresh run and saves the screenshots, `copies.http.txt` and `console-errors.json` in `.verify/<run-id>/evidence/`. It fails on the first expectation that does not hold.

## Gotchas

- Discogs does not quote kroner. The real app converts with the ECB daily rates, fetched at most twice a day. `DISCOGS=fake` uses fixed rates, so the numbers above never change.
- The real Discogs error for missing seller settings was not observed. The gateway treats a 4xx from price suggestions whose body mentions "seller settings" as missing settings, and logs any other error body.
- Copies stay in the run's database. A second drive against the same run sees more rows; filter rows by a fact unique to the pressing.
- Chromium logs the `401` from `/api/me` before login as a console error. It is expected.
