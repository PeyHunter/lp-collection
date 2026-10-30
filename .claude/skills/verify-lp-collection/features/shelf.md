# Shelf

A Member sets up a Shelf from one photo of a cube shelf: take or pick the photo, set columns and rows, drag four dots onto the shelf's outer corners, and see every Section drawn over the photo before saving. Sections are labelled like a spreadsheet: column letter from the left, row number from the top, so C4 is the third column, fourth row. A Collection can have several Shelves. Retaking the photo or moving the corners keeps every Section and the Copies in it. Shrinking the grid or deleting a Shelf moves the affected Copies to Not on a shelf. Only Members of the Collection can see or change its Shelves.

## Sub-features

- `shelves-list` is the "Shelves" tab in the bottom bar (`/shelves`): the region "Your Shelves" lists each Shelf with a thumbnail, "4 × 6 · 24 Sections" and its Copy count, says "N Copies are Not on a shelf." when there are any, and ends with "Set up a Shelf". With no Shelves it says "No Shelves yet."
- `take-photo` is "Take or pick a photo" (`<input type="file" accept="image/*">`, no `capture`). The phone decodes the file with its EXIF rotation, shrinks it to 2560 px on the long edge and sends a JPEG without location. On a saved Shelf the button is "Retake photo".
- `corner-dots` are four buttons named "Top left corner. Drag it, or use the arrow keys." and so on, each a 44 px target. Arrow keys move a dot a little, Shift+arrow more. Crossed dots disable "Save Shelf" and say so.
- `grid-overlay` is the image "Shelf photo with its squares drawn over it": one SVG whose viewBox is the photo's pixel size, with one outlined square and its label per Section, computed by a perspective transform from the four dots. It stays on the photo at any screen width.
- `grid-size` is the region "Squares" with "One column fewer/more" and "One row fewer/more" steppers, 1 to 26 each, and the range ("A1 to D6") in the heading.
- `shrink-warning` shows "N Copies are in squares outside the new grid. Saving moves them to Not on a shelf." before a save that shrinks a grid holding Copies. It does not block the save.
- `delete-shelf` is "Delete this Shelf", then "Delete" in the group "Delete <name>? Its N Copies move to Not on a shelf.".
- `section-identity` keeps each Section's id for its (column, row) across renames, new corners, new photos and grid changes. A square removed and later added back is a new, empty Section.
- `members-only` serves Shelves, their photos and Section changes only under `/api/collections/<id>/...` with the login cookie: a User who is not a Member gets `404`, a logged-out request `401`.

## How to get to it (user POV)

- Bottom bar "Shelves", then "Set up a Shelf" (`/shelves/new`) or a Shelf's name (`/shelves/<id>`).
- API: `GET /api/collections/<id>/shelves` answers `{ shelves, notOnAShelf }`. `POST .../shelves` and `PUT .../shelves/<shelfId>` take a multipart form with `name`, `columns`, `rows`, `corners` (JSON, four `{ x, y }` fractions of the photo in the order top left, top right, bottom right, bottom left) and `photo` (a JPEG, required to create, optional to edit). The create answers `201 { shelf }`, the edit `{ shelf, movedToNotOnAShelf }`. `DELETE .../shelves/<shelfId>` answers `{ movedToNotOnAShelf }`. `GET .../shelves/<shelfId>/photo/<key>` serves the photo. A Shelf has `sections` with `id`, `column`, `row` and `copyCount`.
- `PUT /api/collections/<id>/copies/<copyId>/section` with `{ "sectionId": "<id>" }` or `{ "sectionId": null }` puts a Copy in a Section or takes it out (`204`). No screen calls it yet; ticket 29 adds that.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`.
- Playwright cannot open the iOS camera. `setInputFiles` on "Take or pick a photo" stands in for the picked photo and still goes through the phone's resize and JPEG step. `drawShelfPhoto` in `e2e/shelf-photo.ts` draws a 4 by 6 cube shelf in perspective with its corners at `drawnCorners`.

- **Set up.** Log in as `owner`, add two Copies, tap "Shelves": "No Shelves yet." and "2 Copies are Not on a shelf.". "Set up a Shelf": the name is "Shelf 1". Pick the drawn photo: 24 squares appear inside the starting dots. Drag each dot onto its drawn corner: every label sits in its cube. Name it "Living room", "Save Shelf": the list shows "4 × 6 · 24 Sections".
- **Put Copies in.** `PUT .../copies/<copyId>/section` one Copy into D6 and one into C4. The Shelf now shows `copyCount` 1 on those Sections.
- **Edit.** Open "Living room": the grid lines up again, also at 820 px wide. "Retake photo", "One row fewer": the shrink warning names 1 Copy. "Save Shelf": "4 × 5 · 20 Sections", "1 Copy is Not on a shelf.". The Shelf keeps the same 20 Section ids, its photo URL changed and the old one answers `404`.
- **Members only.** As an invited friend, `GET` the Shelf and its photo: `404`. Logged out, `GET .../shelves`: `401`.
- **Delete.** "Delete this Shelf", then "Delete": "No Shelves yet.", "2 Copies are Not on a shelf.", and the photo answers `404`.
- `node .claude/skills/verify-lp-collection/bin/drive-shelf.ts <run-id>` drives all of the above on a fresh run and saves the screenshots, the `*.http.txt` answers and `console-errors.json` in `.verify/<run-id>/evidence/`. It fails on the first expectation that does not hold.

## Gotchas

- The grid assumes evenly spaced dividers and no lens bending, so the squares drift a little on a real shelf. The highlight only has to find the right square.
- Shelf photos live in the same `PHOTOS_DIR` as Copy photos, named by a random key.
- The `<output>` that shows each stepper's number has the role `status`, so look the shrink warning up by its text, not by `getByRole("status")`.
- Chromium logs the `401` from `/api/me` before login as a console error. It is expected.
