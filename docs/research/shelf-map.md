# Shelf map: research

Researched 2026-10-29 for a possible feature: photograph the record shelves, split the photo into squares, put each Copy in a square, and highlight the square when a Copy is looked up.

Words follow `GLOSSARY.md`. Two new words are used here and are only proposals: **Shelf** (one shelving unit and its photo) and **Section** (one square of a Shelf, labelled like "C4").

How to read the citations: `[n]` points to the numbered source list at the end. Text marked **Unconfirmed** could not be checked against a primary source. Text marked **Analysis** is this document's own reasoning or recommendation, not a fact taken from a source.

---

## Summary in plain language

- **This is very doable, and the simple version needs no "smart" image recognition.** You take one photo of the shelf, say how many rows and columns of squares it has (for example 4 x 6), and drag four dots onto the shelf's four outer corners. The app then works out where every square is in the photo, even though the photo is taken at an angle. This is standard geometry (a "perspective transform"), and the code for it is about 4 KB [1][2].
- **Automatic detection of the squares is possible but not worth it at first.** The standard browser toolkit for it (OpenCV.js) is an 11 MB download (3.5 MB compressed) [3], and the ready-made detectors look for one clean rectangle like a sheet of paper on a plain background [4][5]. That does not match a shelf full of colourful record spines. It could come later as a "suggest corners" button.
- **Taking the photo is easy on iPhone.** A normal "choose photo" button lets you use the camera or pick an existing photo [6][7]. The app shrinks the photo on the phone before uploading, so each shelf photo is small (well under a few megabytes) and the iPhone's HEIC format and sideways photos are handled on the way [8][9][10].
- **Other apps mostly show location as text.** Record and inventory apps store a text location ("Shelf 2, Unit 3", a folder, a box) and show it in search results [11][12][13][14][15]. Libraries show a map with the spot marked [16]. Showing your own shelf photo with the square lit up, plus a big "C4" label, would be better than what most record apps do.
- **The biggest real-world risk is upkeep, not technology.** If you keep records in strict A–Z order, every new record pushes others along and the stored squares go stale. The app should treat the square as "where it lives roughly", make moving one tap, and make re-filling a square fast by scanning.

### Recommended first version

1. Set up one or more Shelves: take or pick a photo, enter rows x columns, drag the four corner dots, check the grid lines up, save. Squares are labelled A1, A2, ... automatically.
2. **Fill a square by scanning:** tap a square, then scan barcodes one after another (or search for records with no barcode). Each record you scan is put in that square. This is how a whole collection gets placed in an evening.
3. On a Copy's page and in the Collection list, show the label ("Shelf 1 · C4") and a small shelf photo with that square highlighted.
4. Scanning or looking up a record you already own also shows where it lives.
5. Move a Copy: tap "Move" and tap another square.

Leave for later: automatic corner detection, order inside a square, "suggest a square" for new records, how-full-is-each-square colouring, and copying the location into Discogs.

---

## 1. Turning a shelf photo into sections in the browser

### (a) Manual: drag four corners, choose rows x columns, perspective transform

**How it works.** A perspective (projective) transform is a 3x3 matrix. Four points in the source and four matching points in the destination are enough to compute it, as long as three of the four are not on one line, and straight lines stay straight after the transform [1]. So the app can treat the shelf front as a flat rectangle split into an even grid (a unit square divided into `cols` x `rows` cells), and map each cell's four corners onto the photo through the matrix computed from the user's four dragged corners. Because straight lines stay straight [1], each cell in the photo is exactly the four-sided shape with those four mapped corners.

**Libraries and size.**
- `perspective-transform` (MIT, no dependencies) takes four source and four destination corners, maps points forward and backward, and exposes the 3x3 coefficients [2]. Its minified file is 4,060 bytes, about 1.6 KB gzipped (measured 2026-10-29 from jsDelivr, version 1.1.3) [17]. It was last published in 2015 [17]. **Analysis:** the maths is about 40 lines (solve an 8x8 linear system), so writing it in the app is also reasonable and avoids an unmaintained dependency.
- OpenCV.js offers the same with `cv.getPerspectiveTransform` and `cv.warpPerspective` [1], but loading 11 MB for this alone is not justified (see (b)).

**Accuracy (Analysis).** The result is as good as the four corner dots and two assumptions:
- *The shelf front is flat and the dividers are evenly spaced.* An even grid will drift slightly if outer panels are thicker than inner dividers or if units are not perfectly aligned. **Unconfirmed:** how far real KALLAX dividers deviate from even spacing in a photo. A later improvement is to let the user drag individual divider lines, stored as fractions (for example column edges at 0, 0.26, 0.5, 0.75, 1).
- *The lens does not bend lines.* A perspective transform cannot correct lens barrel distortion. Taking the photo with the normal 1x camera from a few metres back, not the ultra-wide, keeps this small.
- Highlighting a square only has to be roughly right for a person to find it, so a few pixels of error is harmless.

**Run time (Analysis).** Computing the matrix and 24 cells is a handful of arithmetic operations; it is instant on any phone. No WebAssembly, no extra download.

### (b) Automatic detection (OpenCV.js and other WASM/JS libraries)

**What exists.**
- **OpenCV.js** is OpenCV compiled to WebAssembly. By default the WebAssembly is base64-encoded into one JavaScript file; a `--disable_single_file` build writes a separate `.wasm` file to reduce total size [18]. The build script accepts a `--config` file listing which functions to export, so a smaller custom build is possible [19][20].
- Measured download of the official build (`https://docs.opencv.org/4.x/opencv.js`, which redirects to 4.13.0): **10,964,323 bytes raw, 3,543,357 bytes gzipped** (measured 2026-10-29) [3].
- OpenCV.js includes line detection (`cv.HoughLines`, `cv.HoughLinesP`), which needs a binary edge image first (threshold or Canny) [21], and contour tools such as `approxPolyDP` [20].
- **jscanify** (MIT) is a document scanner built on OpenCV.js; it detects and highlights a paper and corrects its perspective. Its own advice is that "the paper should be placed on a flat surface with a solid background color" [4].
- **scanic** (MIT) is a document scanner that does edge detection in Rust-compiled WebAssembly. It claims under 100 KB gzipped, perspective transforms under 10 ms, an optional ML detector (about 15 KB gzipped plus about 2 MB fetched on first use), and ships a corner editor for manual adjustment [5]. These numbers are the project's own claims, not independently measured. Its npm package (1.7.1) unpacks to 297,137 bytes [22].
- OpenCV.js 4.11.0 broke the basic tutorial on iOS because `cv` became a Promise in the WebAssembly build; this was fixed for 4.12.0 [23]. **Analysis:** a reminder that OpenCV.js upgrades need testing on a real iPhone.

**Accuracy expectations (Analysis, Unconfirmed).** No published benchmark was found for detecting a cube shelf grid filled with records. Document scanners look for the single largest four-sided outline on a plain background [4][5]. A shelf photo is different: dozens of rectangles, record spines and sleeves covering the divider edges, shadows inside each cube, and objects on top. A custom pipeline (edges, then Hough lines, then group lines into near-horizontal and near-vertical families, then fit a grid of known rows x columns) is plausible but would need tuning on real photos and will fail on some. Expect it to find the outer frame of an emptyish shelf often and the frame of a full, cluttered shelf unreliably.

**Load and run time on iPhone Safari (Unconfirmed).** No primary benchmark of OpenCV.js startup or run time on iPhone was found. **Analysis:** downloading 3.5 MB and compiling roughly 8 MB of WebAssembly will take seconds on first use, not milliseconds; after that, a few filters and a Hough transform on a downscaled 1–2 megapixel image should take well under a second. Safari has supported WebAssembly 128-bit SIMD since 16.4 [24], which helps only with a SIMD build. Measure on the target iPhone before committing.

### Hybrid: auto-suggest corners, then the user adjusts

**What it costs (Analysis).**
- The manual corner editor from (a) is needed anyway, because detection will sometimes be wrong. The hybrid is (a) plus a detector that pre-places the four dots.
- If OpenCV.js: about 3.5 MB extra (gzipped) per first use [3], loaded only on the "set up shelf" screen via a dynamic import, which Vite splits into its own chunk [25]. Shelf setup happens rarely, so this does not slow normal use, but it adds a large asset to build, cache and test.
- If scanic: much smaller (claimed under 100 KB gzipped [5]), but it is tuned for documents, so its corners would at best match the outer frame of the shelf.
- Saving: maybe 10 seconds of dragging per Shelf, done a few times ever. **Recommendation:** not worth it for the first version.

### Drawing the highlighted cell on a skewed photo: is `matrix3d` or canvas enough?

Yes, and there is something simpler than either:
- **SVG polygon (recommended, Analysis).** Put the photo and the overlay in one SVG whose `viewBox` is the photo's pixel size. SVG scales the whole thing uniformly to fit the screen (`preserveAspectRatio="xMidYMid meet"` is the default) [26], so a `<polygon>` with the cell's four mapped corners always sits on the right spot at any screen size. The same approach draws all grid lines in setup and colours squares by fullness later. No transform maths in CSS.
- **CSS `matrix3d()`** describes a 4x4 homogeneous matrix and has been available in all browsers since 2015 [27]. A 3x3 homography can be expanded into it, so an HTML element (for example a label) could be warped onto the shelf plane [2]. Only needed if you want text drawn "on" the shelf in perspective.
- **Canvas 2D** can draw the same polygon with `moveTo`/`lineTo`. It works but needs redrawing on resize and is harder to make tappable than SVG.

---

## 2. Taking or uploading the photo in an iOS home-screen web app

### File input vs camera stream

| | `<input type="file" accept="image/*">` (with or without `capture`) | `getUserMedia` (live camera in the page) |
|---|---|---|
| Works on iOS | Yes. `capture` supported in iOS Safari since 10 [7] | Yes. In home-screen apps since iOS 13.4 [28]; needs a secure context [29] |
| Photo quality | Full iOS Camera app: focus, exposure, HDR, chosen resolution | Video frames; full stills need `ImageCapture.takePhoto`, Safari 18.4+ [30] |
| Pick an existing photo | Yes, without `capture` [6] | No |
| Code needed | Almost none | Viewfinder UI, permissions, stream cleanup |

MDN describes `capture` as asking for a new capture with the `user` (front) or `environment` (back) camera, and notes that devices with cameras show a choice between an existing file and a new capture [6]. **Unconfirmed:** exactly which menu iOS shows with and without `capture`; check on device.

**Recommendation (Analysis):** use `<input type="file" accept="image/*">` without `capture`, so the user can either take the photo or pick a better one they took earlier. The app's barcode scanner already uses the live camera, but a shelf photo is a single still where the native camera is better.

### HEIC

- iPhones save camera photos as HEIF/HEIC by default ("High Efficiency"), or JPEG if the user picks "Most Compatible" [8]. The iPhone 16 captures HEIF and JPEG and supports 24 MP and 48 MP photos [31].
- Safari 17 added HEIC decoding, so pages can import and edit such photos "without needing to convert them into another format" [9].
- Safari's file input may convert the picked image itself. A fixed WebKit bug shows Safari converting a HEIC upload to the first type listed in `accept` (JPEG) [32]. Another fixed bug (January 2026) shows the `image/*` wildcard was treated literally and the first non-wildcard type decided the conversion target [33]. **Unconfirmed:** what type a HEIC photo arrives as with plain `accept="image/*"` on current iOS.
- **Recommendation (Analysis):** don't depend on that conversion. Always decode the picked file in the browser and re-encode it as JPEG (next section). The server then only ever stores JPEG.

### EXIF orientation

- CSS `image-orientation` defaults to `from-image`, which rotates images using their EXIF data; Safari has supported it since 13.1 [10][34].
- `createImageBitmap` has an `imageOrientation` option whose default `from-image` applies EXIF orientation [35]. Safari supports `createImageBitmap` from 15 and the `from-image` value from 16 [34].
- **Analysis:** decode with `createImageBitmap(file, { imageOrientation: "from-image" })`, draw to a canvas, export. The exported JPEG has upright pixels and carries no EXIF, which also removes the photo's GPS location before upload.

### Resizing and compressing on the phone

- `createImageBitmap` can resize while decoding with `resizeWidth`/`resizeHeight` and `resizeQuality` [35] (Safari 15+ [34]), which avoids allocating a full 24–48 MP canvas.
- Canvas size is capped in WebKit. Current WebKit source limits a canvas on iOS to 8192 x 8192 pixels of area (16384 x 16384 elsewhere) [36]. **Unconfirmed:** the limit in shipped iOS versions; older reports cite 4096 x 4096 (16.7 million pixels) and a total canvas memory cap [37].
- `canvas.toBlob(callback, "image/jpeg", quality)` exports JPEG with a 0–1 quality; an unsupported type silently falls back to PNG [38]. Safari does not support WebP output from `toBlob` [34], so use JPEG. `OffscreenCanvas` (Safari 16.4+) can do the same off the main thread [34][24].
- **Recommendation (Analysis):** long edge 2560 px, JPEG quality about 0.8. That is plenty to see 24 squares.

### Storage size (Analysis, Unconfirmed until measured)

A 2560 px JPEG of a shelf at quality 0.8 should be a few hundred KB, under 1 MB. With a handful of Shelves per Collection that is negligible next to Copy photos, which the spec already stores on a persistent volume with nightly backups [39][40]. Store the shelf photo the same way as Copy photos. Measure a real shelf photo during the first ticket.

---

## 3. How existing products show "where is this item"

| Product | How location is stored | How it is shown |
|---|---|---|
| Discogs | Collection folders and custom fields (dropdown or free text) on each collection item [41][42]. Values can be read and written through the API's collection fields endpoints (see section 4) | As a field value. No shelf map found |
| CLZ Music | An album-level **Location** field; the collection can be grouped by Location to see all albums per box [12]. Per-disc **Storage Device** and **Slot** fields for carousels and binders [11] | Text, and grouped lists |
| Music Tracker: Vinyl Catalog | "Set a Location, a Shelving unit, and a specific Shelf" per record [13] | Text |
| Shelfify – Vinyl Organizer | "room, shelf, compartment, and position"; layouts drawn on a "drag-and-drop canvas" [14] | Search shows "where any item is stored" on the drawn layout |
| Sortly (home and business inventory) | "locations = folders" [15] | Search results show the item with its folder [15] |
| Libraries (StackMap) | Call number determines the shelf range | A "map it" link opens a floor map with the item's location and configured directions [16] |
| Warehouses (Odoo) | Nested locations written as paths such as `WH/Stock/Shelf 1` [43] | Path text; "putaway rules" route incoming items to a set location automatically, e.g. a product category to Shelf 1 [43] |
| Vinyl Shelf Finder (hobby project) | Each LP's shelf position entered in its Discogs record | A pan-and-tilt laser points at the record when picked in an app [44] |

**What works for finding one item fast on a phone (Analysis, drawing on the table):**
- **Show the location in the list, not only on the detail page.** Sortly puts the folder in search results [15]; the user can read "C4" without opening anything.
- **Big short code first, picture second.** A short label like "C4" is what people remember and say out loud; the highlighted photo removes doubt about which C4. Libraries pair the map with text directions [16].
- **One fixed label scheme**, visible on the photo during setup, so the same square is always called the same thing.
- **Your own photo beats a drawn layout.** Shelfify asks the user to draw their layout [14]; using the real photo skips that step and is recognisable at a glance. No record app was found that uses a photo of the user's own shelf (**Unconfirmed** that none exists).

---

## 4. Data model options

**Context.** The spec's data model has Collection, Membership, Copy and Photo, and a Photos module storing images on a persistent volume [39]. Every Collection has one Owner; Members can add, edit and delete Copies [40][39].

### Proposed shape (Analysis)

- **Shelf**: `id`, `collection_id`, `name` ("Living room"), `rows`, `cols`, `photo` (path on the photo volume, nullable), `corners` (four points as fractions 0–1 of the photo's width and height, so they survive any re-encode), optional `col_edges` and `row_edges` (fractions, for uneven dividers), `position` (order of Shelves on screen), timestamps.
- **Section**: `id`, `shelf_id`, `row`, `col`, optional `label` override, optional `capacity`. Unique on (`shelf_id`, `row`, `col`). Default label is derived (row letter + column number).
- **Copy**: add nullable `section_id` (foreign key, `ON DELETE SET NULL`) and nullable `position_in_section`.

**Why store Sections as rows instead of only `(shelf_id, row, col)` on the Copy?** A Section row gives each square a stable ID, a place for a custom label and a capacity, and lets the database list empty squares. The cost is creating `rows x cols` rows when a Shelf is created. Either works; Section rows make re-shaping (below) explicit.

### Several shelf units

Each unit is its own Shelf with its own photo and corners, shown in a list or swipeable row. IKEA KALLAX, a common record shelf with 13 x 13 inch compartments, comes in 1x4, 2x2, 2x4, 3x3, 3x4, 4x4 and 5x5 sizes [45], so "24 squares" could be one 4x6 wall or, for example, three 2x4 units. **Analysis:** one photo covering several side-by-side units can be one Shelf only if they are flush and in one plane; otherwise separate Shelves are more accurate. This is a question for the user.

### Order inside a Section

- Optional. If kept, use a sortable key such as a fraction between neighbours, so moving one record changes only that record's value [46].
- **Analysis:** precise order is the most upkeep-heavy part of the feature and is easy to get wrong. A cheaper alternative is to derive "about where in the square" from sorting the Section's Copies by artist when the user files alphabetically.

### Re-photographing or resizing the grid without losing assignments

- **Re-photograph** (furniture moved, better photo): only `photo` and `corners` change. Copies point at Sections, and Sections are logical (row, column), so nothing is lost.
- **Resize the grid** (added a unit, changed 4x4 to 4x6): keep Sections whose (row, col) still exist; create new ones; for Sections that would disappear, show how many Copies are in them and either block the change or move those Copies to "Not on a shelf". Never delete a Copy's assignment silently.
- Deleting a Shelf sets its Copies' `section_id` to null (they become "Not on a shelf").

### Members sharing a Collection

Shelves belong to the Collection, not the User, so every Member sees and edits the same shelf map, matching how Copies are shared [39][40]. Access rules are the existing ones: only Members of a Collection see its Shelves. **Analysis:** last write wins is fine for moving records; the two people are rarely moving the same record at once.

### Export and Discogs

- **Analysis:** add a "Location" column (`Shelf · Label`) to the CSV export the spec already plans [39].
- Optional: mirror the location into a Discogs collection custom field, in keeping with the one-way mirror (ADR-0002) [47]. Discogs lets users create custom collection fields of type dropdown or free text on its website [42]. The API lists a user's collection fields at `GET /users/{username}/collection/fields` and sets a value with `POST /users/{username}/collection/folders/{folder_id}/releases/{release_id}/instances/{instance_id}/fields/{field_id}` [48][49]. **Unconfirmed:** the official Discogs API page could not be fetched (it blocks automated access), so these endpoints were confirmed only through client libraries and an OpenAPI description [48][49]; and whether the API can *create* a new field (it appears not) is unconfirmed. This is a nice extra, not part of the first version.

---

## 5. Shortcuts that would delight

- **Fill a square by scanning (high value, Analysis).** Tap a square, then scan records one after another; each scan finds the matching Copy in the Collection and assigns it. The spec already has an in-browser barcode scanner and Lookup that flags Releases the Collection already has a Copy of [39], so this reuses existing parts. CLZ has a similar scan-into-a-queue flow with an "Add [..] to Collection" button for adding all scanned albums at once [50]. Edge cases: a barcode identifies a Release, not a Copy, so if the Collection has two Copies of that Release the app must ask which one; a scanned record not yet in the Collection can be offered "Add and place here".
- **Scan to find where it goes back.** Scanning a record you already own shows its square. Same parts as above, used when tidying up.
- **Suggest a square for a new Copy (Analysis).** Like a warehouse putaway rule that routes a category to a shelf [43]:
  - *Alphabetical:* if Sections are filled in reading order by artist, suggest the Section whose first-to-last artist range contains the new artist.
  - *By genre:* suggest the Section where most Copies share the new Release's genre (the spec caches Discogs genres per Release [39]).
  - *Sticky last square:* in "fill" mode, keep the same square until the user changes it.
  Always a suggestion the user confirms, never automatic.
- **How full each square is (Analysis).** Count Copies per Section and colour the squares on the photo, or show "38" in each square. If the user sets a capacity per square, show full/near-full; Odoo's storage categories use the same idea of a per-location capacity [51]. **Unconfirmed:** how many LPs fit in one KALLAX cube; ask the user or learn from their own counts.
- **"Not on a shelf" list.** A filter for Copies without a Section, to finish the setup.

---

## 6. Risks, unknowns and the smallest useful version

### Risks and unknowns

| Risk | Why it matters | Mitigation (Analysis) |
|---|---|---|
| Locations go stale | Strict A–Z filing shifts records between squares as the collection grows | Fast "fill a square by scanning"; one-tap Move; treat the square as approximate |
| Uneven dividers or lens bending | Even grid drifts from the real dividers | Shoot with the 1x camera from further back; later, draggable divider lines |
| Several units not in one plane | One perspective transform cannot fit two angled units | One Shelf per unit |
| Large photos on iPhone | Canvas area and memory limits in WebKit [36][37] | Resize while decoding with `createImageBitmap` [35]; 2560 px long edge |
| HEIC and upload type vary by Safari version | Conversion behaviour has changed across WebKit fixes [32][33] | Always decode and re-encode to JPEG on the phone |
| Auto-detection accuracy | No benchmark for cluttered shelves (Unconfirmed) | Ship manual corners first; spike detection on real photos later |
| OpenCV.js size and upgrades | 3.5 MB gzipped [3]; an upgrade broke iOS usage once [23] | Avoid it in the first version |
| Duplicate Copies of one Release | A barcode scan cannot tell them apart | Ask which Copy when the Collection has more than one |
| Shelf photo goes out of date | Furniture moves, new units | Re-photograph keeps all assignments (section 4) |

### Smallest first version that would still be useful

See "Recommended first version" at the top. In build terms (Analysis):

1. Database: `shelf` and `section` tables; nullable `section_id` on Copy.
2. API: create/update/delete Shelf (with photo upload and corners); assign or clear a Copy's Section; list Copies by Section; include `section` in Copy responses.
3. UI: shelf setup (photo, rows x columns, four draggable corners over an SVG grid preview); shelf view (photo plus SVG grid, counts per square); "fill this square" scan mode; location label and highlighted thumbnail on the Copy page and in the list; Move.
4. No new heavy dependency: perspective maths in about 40 lines or the 4 KB `perspective-transform` [17].
5. Tests at the HTTP seam for assignment, re-shaping and Member access, and one Playwright test at iPhone size that sets up a Shelf from a still image, matching the spec's testing approach [39].

---

## Sources

1. OpenCV.js tutorial "Geometric Transformations of Images", Perspective Transformation section (source of docs.opencv.org/4.x/dd/d52/tutorial_js_geometric_transformations.html). https://github.com/opencv/opencv/blob/4.x/doc/js_tutorials/js_imgproc/js_geometric_transformations/js_geometric_transformations.markdown
2. `perspective-transform` repository README. https://github.com/jlouthan/perspective-transform
3. OpenCV.js official build, downloaded and measured 2026-10-29 (`https://docs.opencv.org/4.x/opencv.js` redirects to `https://docs.opencv.org/4.13.0/opencv.js`; `Content-Length: 10964323`; `gzip -9` output 3,543,357 bytes).
4. jscanify repository README. https://github.com/puffinsoft/jscanify
5. scanic repository README. https://github.com/marquaye/scanic
6. MDN, HTML attribute: `capture`. https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture
7. MDN browser-compat-data, `html.elements.input.capture` (Safari iOS 10). https://github.com/mdn/browser-compat-data/blob/main/html/elements/input.json
8. Apple Support, "Using HEIF or HEVC media on Apple devices". https://support.apple.com/en-us/116944
9. WebKit blog, "News from WWDC23: WebKit Features in Safari 17 beta" (HEIC). https://webkit.org/blog/14205/news-from-wwdc23-webkit-features-in-safari-17-beta/
10. MDN, CSS `image-orientation`. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/image-orientation
11. CLZ Music, "v6.4: Lots of new database fields" (Storage Device and Slot). https://clz.com/music/mobile/whatsnew/2021/08/19/v6-4-lots-of-new-database-fields
12. CLZ Club forum, "Storage" thread (Location field, group by Location; answer by user CLZ_AJ, staff status not stated on page). https://club.clz.com/t/storage/1356
13. App Store, "Music Tracker: Vinyl Catalog". https://apps.apple.com/app/apple-store/id6450698274
14. App Store, "Shelfify – Vinyl Organizer" (Appfium UG). https://apps.apple.com/us/app/id6759003070
15. Sortly Help Center, "View item locations in Sortly". https://help.sortly.com/view-item-locations-in-sortly
16. OCLC Help, "Locate items in the library with StackMap". https://help.oclc.org/Discovery_and_Reference/WorldCat_Discovery/Search_results/Locate_items_in_the_library_with_StackMap
17. jsDelivr package listing and file `perspective-transform@1.1.3/dist/perspective-transform.min.js` (4,060 bytes; 1,622 bytes `gzip -9`), measured 2026-10-29; npm registry entry. https://data.jsdelivr.com/v1/package/npm/perspective-transform@1.1.3 and https://registry.npmjs.org/perspective-transform
18. OpenCV.js tutorial "Build OpenCV.js" (single-file base64 default, `--disable_single_file`, SIMD and threads options). https://github.com/opencv/opencv/blob/4.x/doc/js_tutorials/js_setup/js_setup/js_setup.markdown
19. OpenCV `platforms/js/build_js.py` (`--config` "Specify configuration file with own list of exported into JS functions"). https://github.com/opencv/opencv/blob/4.x/platforms/js/build_js.py
20. OpenCV `platforms/js/opencv_js.config.py` (default whitelist, includes `approxPolyDP`, `perspectiveTransform`). https://github.com/opencv/opencv/blob/4.x/platforms/js/opencv_js.config.py
21. OpenCV.js tutorial "Hough Line Transform". https://github.com/opencv/opencv/blob/4.x/doc/js_tutorials/js_imgproc/js_houghlines/js_houghlines.markdown
22. npm registry, `scanic` 1.7.1 (`unpackedSize` 297,137). https://registry.npmjs.org/scanic
23. opencv/opencv issue #27129, "Basic example for opencv.js doesn't work with version 4.11.0 and later". https://github.com/opencv/opencv/issues/27129
24. WebKit blog, "WebKit Features in Safari 16.4" (WebAssembly 128-bit SIMD, OffscreenCanvas 2D). https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
25. Vite docs, Features (dynamic import, async chunks, WebAssembly). https://vite.dev/guide/features
26. MDN, SVG `preserveAspectRatio`. https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/preserveAspectRatio
27. MDN, CSS `matrix3d()`. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/transform-function/matrix3d
28. WebKit Bugzilla 185448, "getUserMedia not working in apps added to home screen that run in standalone mode" (RESOLVED FIXED; confirmed in iOS 13.4 beta 1). https://bugs.webkit.org/show_bug.cgi?id=185448
29. MDN browser-compat-data, `api.MediaDevices.getUserMedia` (Safari 11, secure context required). https://github.com/mdn/browser-compat-data/blob/main/api/MediaDevices.json
30. MDN browser-compat-data, `api.ImageCapture` and `takePhoto` (Safari 18.4). https://github.com/mdn/browser-compat-data/blob/main/api/ImageCapture.json
31. Apple, iPhone 16 Technical Specifications. https://www.apple.com/iphone-16/specs/
32. WebKit Bugzilla 292350, "harmonize codepath for Image transcoding for input and drag/drop" (RESOLVED FIXED, 2026-02-18). https://bugs.webkit.org/show_bug.cgi?id=292350
33. WebKit Bugzilla 303803, "PNG converted to HEIC on file upload seemingly not accepted by image/* wildcard" (RESOLVED FIXED, 2026-01-08). https://bugs.webkit.org/show_bug.cgi?id=303803
34. MDN browser-compat-data: `css.properties.image-orientation` (Safari 13.1), `api.createImageBitmap` and its options (Safari 15; `from-image` 16), `api.HTMLCanvasElement.toBlob` (`image/webp` not supported in Safari), `api.OffscreenCanvas` (Safari 16.4). https://github.com/mdn/browser-compat-data (files `css/properties/image-orientation.json`, `api/_globals/createImageBitmap.json`, `api/HTMLCanvasElement.json`, `api/OffscreenCanvas.json`)
35. MDN, `Window.createImageBitmap()`. https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
36. WebKit source, `Source/WebCore/html/CanvasBase.cpp`, `maxCanvasArea()` (iOS family `8192 * 8192`, otherwise `16384 * 16384`), main branch read 2026-10-29. https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp
37. WebKit Bugzilla 195325 and Apple Developer Forums thread 687866 (total canvas memory limit reports; older 4096 x 4096 area reports). https://bugs.webkit.org/show_bug.cgi?id=195325 and https://developer.apple.com/forums/thread/687866 — seen through search results only, not opened directly.
38. MDN, `HTMLCanvasElement.toBlob()`. https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
39. LP-Collection spec, GitHub issue #1 "Spec: LP-Collection v1". https://github.com/PeyHunter/lp-collection/issues/1
40. LP-Collection `GLOSSARY.md` (Owner, Member, Collection, Copy) and `docs/adr/0003-self-hosted-on-k3s-behind-cloudflare-tunnel.md` (photo storage and nightly backups).
41. Discogs Support, "How Does The Collection Feature Work?" (folders, Manage Custom Fields). https://support.discogs.com/hc/en-us/articles/360007331534 — seen through search results only; the page blocks automated fetching.
42. Discogs Support, "Customizing Your Collection Notes" (field type dropdown or free text, options). https://support.discogs.com/hc/en-us/articles/360007331674-Customizing-Your-Collection-Notes — seen through search results only; the page blocks automated fetching.
43. Odoo 18 documentation, "Putaway rules". https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/putaway.html
44. Raspberry Pi News, "Vinyl Shelf Finder" (Janina Ander, 26 September 2017). https://www.raspberrypi.com/news/vinyl-shelf-finder/
45. IKEA, KALLAX buying guide PDF (January 2026; shelf unit sizes and 13 x 13 inch inserts). https://www.ikea.com/us/en/files/pdf/9d/d5/9dd5cb95/kallax_jan_2026.pdf
46. Figma blog, "Realtime editing of ordered sequences" (fractional indexing). https://www.figma.com/blog/realtime-editing-of-ordered-sequences/
47. LP-Collection `docs/adr/0002-app-is-the-source-of-truth.md`.
48. discogsAPI R package, `edit_field_instance` reference. https://rdrr.io/github/Pascallio/discogsAPI/man/edit_field_instance.html
49. minim Python client, Discogs `UsersAPI` reference (collection fields). https://minim.readthedocs.io/en/dev/api-ref/minim.api.discogs.UsersAPI.html
50. CLZ Music, "Add Albums by Barcode: add all scanned albums in one go" (2019). https://clz.com/music/mobile/whatsnew/2019/07/16/add-albums-by-barcode-add-all-scanned-albums-in-one-go — content seen through search results; the page blocks automated fetching.
51. Odoo 16 documentation, "Storage categories" (capacity per location). https://www.odoo.com/documentation/16.0/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/storage_category.html — seen through search results only.
