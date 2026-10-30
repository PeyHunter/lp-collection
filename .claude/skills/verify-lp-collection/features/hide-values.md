# Hide Values

A "Values" switch in the header of the Collection and of every Copy hides everything about Value, so the User can show their Collection to others without showing what it is worth. With it off, the app looks as if Values never existed: no amount, Gain, Lowest listing, Purchase price, Value sort, Value group heading, seller settings guide or currency picker, and no gap where they were. The API leaves the same fields out, so nothing leaks over the network. Turning it on shows every Value again from what is already stored, without asking Discogs. Each User has their own switch, kept across reloads and devices.

## Sub-features

- `switch` is a `role="switch"` button named "Values" at the end of the header on the Collection (`/`) and on a Copy (`/copies/<id>`). It is checked while Values show. It saves at once and stays as set after a reload.
- `collection-off` hides the amount on each row, the Value sort chip (Artist becomes the first and default sort), the Value group headings, the seller settings guide and the currency picker. A list sorted by Value shows by Artist A to Z.
- `copy-off` hides the Value section (amount, Gain, Lowest listing, "Paid …") and the Purchase section, and the hint that the Value follows the Media condition.
- `api-off` leaves `value`, `gain`, `purchasePrice`, `purchaseDate` and `sellerSettingsMissing` out of every Copy answer (list, Copy, save, change, photos), refuses `sort=value` with `400`, and makes `POST /values` fetch no Value (it only fills in missing genres and answers `{ "more": … }`). Saving a Copy or changing its Media condition asks Discogs for no Value.
- `back-on` shows the stored Values, Gain and Purchase price again without a Discogs request. Copies saved while Values were off get their Value from the background fetch.
- `per-user` keeps one switch per User, so two Members of one Collection each see what they chose.

## How to get to it (user POV)

- Collection (`/`) or any Copy: tap "Values" at the top right.
- API: `GET /api/me` answers `showValues`. `PUT /api/me/show-values` with `{ "showValues": false }` or `true` answers `{ "showValues": … }`. Anything but a boolean answers `400`, and no session answers `401`.

## Driving it with verify-lp-collection

Preconditions: baseline state, `doctor.ts` reports `HEALTHY`.

- Log in as `owner` and save Kind Of Blue (`2474032`), Discovery (`16893476`) and Hounds Of Love (`13716287`). Give Kind Of Blue a Purchase price of 100 DKK bought 12 Mar 2019.
- On `/`, each row shows an amount in kroner and the switch is checked. Tap "Values": the switch is unchecked, the rows show no amount, the sort chips are Artist, Period, Year and Added, and the currency picker is gone. Reload: the same.
- With the switch off, `GET /copies` and `GET /copies/<id>` carry none of the fields above, `GET /copies?sort=value` answers `400`, and `POST /values` answers `{ "more": false }`.
- Open Kind Of Blue: no Value or Purchase section. Tap "Values": the Value section shows "Paid 100 kr on 12 Mar 2019", and the Copy answer is the same as before the switch went off, with the same `fetchedAt`.
- `node .claude/skills/verify-lp-collection/bin/drive-hide-values.ts <run-id>` drives all of the above on a fresh run and saves `collection-values-on.png`, `collection-values-off.png`, `copy-values-off.png`, `copy-values-on.png`, `collection-values-back-on.png`, the `*.http.txt` answers and `console-errors.json` in `.verify/<run-id>/evidence/`.

## Gotchas

- The switch is per User, not per Collection. A Member who keeps Values on still sees them in a Collection whose Owner hid them.
- The Lookup screen never shows a Value, so it has no switch.
- The test suite proves that no Discogs price request happens while Values are off or when they come back on (`test/api/hide-values.test.ts`). The live run cannot count Discogs requests, so it compares the Copy answer before and after instead.
