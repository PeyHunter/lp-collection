# CSV export

At the bottom of the Collection, "Download as spreadsheet (CSV)" downloads every Copy in the Collection as a spreadsheet for insurance or selling. It has one row per Copy, sorted by artist, with artist, title, label, Catalog number, Original year, Pressing year, both conditions, Value, Lowest listing, Currency, Purchase price and its currency, Gain and note. Danish letters stay intact in Excel and Numbers. With Values hidden the file leaves out every Value column.

## Sub-features

- `link` is a link named "Download as spreadsheet (CSV)" in the Account section at the bottom of `/`. It downloads `lp-collection-YYYY-MM-DD.csv`.
- `format` is RFC 4180 CSV: comma separated, CRLF line ends, fields with a comma, quote or line break in double quotes, and a UTF-8 byte order mark first so Excel reads æ, ø and å. Money has two decimals and a dot. Text starting with `=`, `+`, `-` or `@` gets a leading `'` so a spreadsheet doesn't run it as a formula.
- `values-off` drops Value, Lowest listing, Currency, Purchase price, Purchase currency and Gain while the User hides Values.

## How to get to it (user POV)

- Collection (`/`): scroll to the bottom and tap "Download as spreadsheet (CSV)".
- API: `GET /api/collections/<id>/export.csv` answers `200` with `text/csv; charset=utf-8` and `content-disposition: attachment`. No session answers `401`, and another Collection answers `404`.

## Driving it with verify-lp-collection

Preconditions: baseline state, `doctor.ts` reports `HEALTHY`.

- Log in as `owner`, save Kind Of Blue (`2474032`), Discovery (`16893476`) and Abbey Road (`13716287`), and give Kind Of Blue the note `Købt på Ærø, "næsten" ny` and a Purchase price of 100 DKK.
- On `/`, tap the link: the file starts with bytes `ef bb bf`, has the header and three rows, and the note is quoted with its quotes doubled.
- Tap "Values" to hide them and download again: the header has no Value columns.
- `node .claude/skills/verify-lp-collection/bin/drive-csv-export.ts <run-id>` drives all of the above and saves `collection-export-link.png`, `collection-export-values-off.png`, `collection-values-on.csv`, `collection-values-off.csv` and `console-errors.json` in `.verify/<run-id>/evidence/`, where only the `401` before login is expected.

## Gotchas

- The file uses commas. Excel set to a Danish locale expects semicolons and may put each row in one cell when the file is double-clicked; File > Import (or Data > From Text/CSV) with comma as the separator reads it right. Numbers and Google Sheets detect the comma.
- Chromium in the drive script stands in for Safari. On an iPhone, Safari shows the file in a preview with a share button rather than saving it straight to Files.
