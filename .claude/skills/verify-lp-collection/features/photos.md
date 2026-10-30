# Photos

A Member can take or pick photos of a Copy on its Copy page to show its real condition. The phone turns each photo into an upright JPEG no longer than 2048 px and uploads it. A Copy with photos shows its first photo on the Copy page and as its Collection row thumbnail; a Copy without photos shows the Discogs cover. Photos can be deleted one by one, and deleting a Copy deletes its photos. Only Members of the Collection can fetch, add or delete them.

## Sub-features

- `add-photo` is "Take or pick a photo" in the region "Photos" on the Copy page. It opens the iOS camera-or-library menu (`<input type="file" accept="image/*" multiple>`). While it uploads the button says "Adding photo…" ("Adding photo 2 of 3…" for several).
- `resize-on-phone` decodes the picked file (HEIC, PNG, JPEG) with its EXIF orientation applied, shrinks it to 2048 px on the long edge, and sends a JPEG at quality 0.85. The JPEG carries no EXIF, so no location leaves the phone.
- `photo-order` lists photos oldest first. The first one is the Copy's picture (`pictureUrl` in the API).
- `cover-fallback` shows the Discogs cover on the Copy page and the row while a Copy has no photos, with "No photos yet. The Discogs cover shows until you add one of your own Copy."
- `delete-photo` is "Delete photo N" under each photo, then "Delete" in the group "Delete this photo?" ("Keep it" cancels).
- `delete-copy` is "Delete this Copy" at the end of the Copy page, then "Delete Copy" in the group "Delete <title> and its N photos? This can't be undone." The Collection then says "Deleted <title> from your Collection." The Copy is not removed from the Owner's Discogs collection yet, because the app does not mirror to Discogs yet.
- `server-checks` accept only a whole JPEG up to 10 MB and 8192 px a side: any other file is `415`, a cut or damaged JPEG is `400`, more than 10 MB is `413`. Files are named by a random 32-hex-character key with `.jpg`, never by anything the upload sent.
- `members-only` serves photos only through `/api/collections/<id>/...` with the login cookie and `Cache-Control: private`. A User who is not a Member gets `404`, a logged-out request `401`.

## How to get to it (user POV)

- Copy page (`/copies/<id>`): the big picture at the top, the region "Photos" after "Condition", and "Delete this Copy" at the end.
- Collection (`/`): each row's thumbnail.
- API: `POST /api/collections/<id>/copies/<copyId>/photos` with the JPEG bytes as the body (answers `201` and `{ copy }`), `GET` and `DELETE /api/collections/<id>/copies/<copyId>/photos/<photoId>` (the delete answers `{ copy }`), `DELETE /api/collections/<id>/copies/<copyId>` (`204`). Every Copy answer carries `photos` (`id`, `url`, `width`, `height`) and `pictureUrl`.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`.
- Unless `PHOTOS_DIR` is set before `launch.ts`, the app keeps photos in the run's throwaway folder, which is deleted with the run's database when it stops. Set `PHOTOS_DIR` to keep them.
- Playwright cannot open the iOS camera. `setInputFiles` on the label "Take or pick a photo" stands in for the picked photo, and it still goes through the phone's resize and JPEG step.

- **No photos.** Log in as `owner`, add Discovery (`190295328709`), open it. Expect "No photos yet." and the big picture `/fake-discogs/covers/16893476.svg`.
- **Add.** Set a 4032 x 3024 image on "Take or pick a photo". Expect "Adding photo…", then the image "Photo 1 of Discovery" at 2048 x 1536, the same URL in the big picture, and after a reload still there. Back on the Collection the Discovery row shows it.
- **Members only.** `GET` the photo URL as the owner: `200`, `image/jpeg`, `Cache-Control: private, …`. As an invited friend: `404`. Logged out: `401`.
- **Delete.** "Delete photo 2" then "Delete": one photo left. "Delete this Copy" then "Delete Copy": the status "Deleted Discovery from your Collection.", one row fewer, and the photo URL now answers `404`.
- `node .claude/skills/verify-lp-collection/bin/drive-photos.ts <run-id>` drives all of the above on a fresh run and saves the screenshots, the `*.http.txt` answers and `console-errors.json` in `.verify/<run-id>/evidence/`. It fails on the first expectation that does not hold.

## Gotchas

- The photo request carries the login cookie like any same-origin image, so an `<img>` works without extra code. A photo URL copied to another browser shows nothing unless that browser is logged in as a Member.
- What iOS hands the page for a HEIC photo is unconfirmed on a real device (`docs/research/shelf-map.md` §2). The page decodes whatever arrives with `createImageBitmap`, so it does not depend on Safari converting it first.
- Photos stay in the run's temp folder until the app stops. Copies and photos from earlier drives stay in the run's database.
- Chromium logs the `401` from `/api/me` before login as a console error. It is expected.
