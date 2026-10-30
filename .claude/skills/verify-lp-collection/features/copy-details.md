# Copy details

A Member can give a Copy a note, a Purchase price and a purchase date on its Copy page, change them and clear them. The Copy page then shows the Gain, the Value minus the Purchase price, next to the Value: green with a plus when the Copy is worth more than was paid, red with a minus when it is worth less. The Value and the Gain sit right after the title, so they show on an iPhone without scrolling. A Member can also delete the Copy.

## Sub-features

- `purchase` is the region "Purchase": "Purchase price" (a text field that takes `149,95`, `1.200` or `1,200.50`), the select "Purchase currency" (it starts at the User's Currency), "Purchase date" (a date field), "Save purchase", and "Clear" once something is saved. A saved purchase shows "The purchase saved."; a typo shows "The purchase wasn't saved. Type the price as a number, such as 149,95."
- `note` is the region "Note": the textbox "Note" (up to 2000 characters, it grows with the text) and "Save note". An empty note saves as no note.
- `gain` is "Gain +102 kr" or "Gain −948 kr" on the Value row, and only when the Copy has both a Value and a Purchase price. Under the Lowest listing a line says "Paid 150 kr on 12 Mar 2019".
- `currency` keeps the Purchase price in the currency it was paid in. Gain converts it to the viewer's Currency with the ECB rates, and the line then ends with ", converted at today's ECB rate".
- `server-checks` refuse with `400` and change nothing: a note that isn't text or is longer than 2000 characters, an amount below 0 or with more than two decimals, an unknown currency, a date that isn't a real `YYYY-MM-DD` day or is after tomorrow in UTC.
- `delete-copy` is "Delete this Copy" at the end of the page, then "Delete Copy" in the group "Delete <title>? This can't be undone." It is the same step as in [Photos](./photos.md).
- `members-only` lets only Members change details: a User who is not a Member gets `404`, a logged-out request `401`.

## How to get to it (user POV)

- Copy page (`/copies/<id>`): the Value region right after the title, then the Release facts, "Condition", "Purchase", "Note", "Photos" and "Delete this Copy".
- API: `PATCH /api/collections/<id>/copies/<copyId>` with any of `note` (text or `null`), `purchasePrice` (`{ amount, currency }` or `null`) and `purchaseDate` (`YYYY-MM-DD` or `null`), alone or with the conditions. It answers `{ copy, sellerSettingsMissing }`. Every Copy answer carries `note`, `purchasePrice`, `purchaseDate` and `gain` (in the Value's currency, or `null`).

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`.
- The fake Discogs prices Discovery (`190295328709`) at 252 kr in Very Good Plus, and its exchange rates are fixed.

- **Above the fold.** Log in as `owner`, add Discovery, open it. Expect the Value in the viewport and no "Gain".
- **Set.** Type `149,95`, pick 12 March 2019, "Save purchase". Expect "The purchase saved.", "Gain +102 kr" in green on the Value row and "Paid 150 kr on 12 Mar 2019". After a reload the fields still hold `149,95` and `2019-03-12`.
- **Note.** Type a note, "Save note", reload. The note is still there.
- **Negative Gain.** Type `1.200`, save. Expect "Gain −948 kr" in red.
- **Other currency.** Type `20`, pick EUR, save. Expect "Paid 20 € on 12 Mar 2019, converted at today's ECB rate".
- **Refused.** Type `twelve`, save: the error card. `PATCH` a `purchaseDate` of `2999-01-01`: `400`.
- **Clear.** "Clear", then empty the note and "Save note". After a reload there is no Gain, no "Paid" line and both fields are empty.
- **Members only.** An invited friend's `PATCH` answers `404`, a logged-out one `401`.
- **Delete.** "Delete this Copy", then "Delete Copy". Expect "Deleted Discovery from your Collection." and the Copy answers `404`.
- `node .claude/skills/verify-lp-collection/bin/drive-copy-details.ts <run-id>` drives all of the above on a fresh run and saves the screenshots, the `*.http.txt` answers and `console-errors.json` in `.verify/<run-id>/evidence/`. It fails on the first expectation that does not hold.

## Gotchas

- Gain and the Paid line round to whole kroner, as Values do. The Purchase price field keeps the øre.
- Chromium shows the date field as `mm/dd/yyyy` under the iPhone profile. Safari on a phone opens its own date wheel.
- Chromium logs the `401` from `/api/me` before login as a console error. It is expected.
