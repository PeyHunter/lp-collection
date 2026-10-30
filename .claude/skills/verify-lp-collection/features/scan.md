# Scan a barcode with the camera

A logged-in User taps Scan and the Lookup screen opens the rear camera inside a frame. When the camera reads an EAN-13 or UPC-A barcode, the screen says "Read <digits>", fills the Barcode field and runs the same Lookup as typing (see [add-copy.md](./add-copy.md)). The camera turns off after a read, when the User leaves the screen, and while the app is in the background. When the camera is blocked, missing or fails, the screen says so and the User types the barcode instead.

## Sub-features

- `scan-read` reads the barcode, shows the status "Read <digits>", fills "Barcode" and shows the matches.
- `scan-another` is the "Scan another" button after a read. It turns the camera on again.
- `camera-off` ends the camera's track after a read and when the User leaves `/lookup`.
- `camera-blocked` shows "LP-Collection isn't allowed to use the camera. Type the barcode below instead. …" with "Try the camera again".
- `camera-missing`, `camera-unsupported` and `camera-failed` show their own sentence, each ending in the typed fallback. Only `camera-blocked` is drivable here.
- `decode` reads EAN-13 and UPC-A, tilted, curved, under glare and in dim light. `test/decode-barcode.test.ts` covers it on drawn photos.

## How to get to it (user POV)

- Tap "Scan" in the bottom bar, or "Add your first record" on an empty Collection. Both open `/lookup`, and the camera starts at once.
- After a read, tap "Scan another" to read the next sleeve.
- There is no API entry point. The scan only fills the Lookup, which then calls `GET /api/collections/<id>/lookup?barcode=<digits>`.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`. Log in as `owner` on the Fake Discogs page.
- A camera that films a sleeve. Chromium's fake camera plays a still image: `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<file>.y4m`. Make the file with `barcodePhoto` and `y4m` from `test/support/barcode-photo.ts`. Launch with `chromium.launch({ channel: "chromium", args })`, because the headless shell has no camera, and grant the context the `camera` permission.
- Only Gas 5 (`5099969209017`) in the fake Discogs has a valid check digit. The Kind Of Blue and Discovery sample barcodes do not, so no camera can read them.

- **Scan and save.** Write a Playwright script in the evidence folder with `devices["iPhone 15"]` and a fake camera filming `barcodePhoto({ ...straight, tiltDegrees: 6, curve: 0.6, glare: { at: [0.55, 0.45], radiusPx: 70, strength: 0.5 }, barcode: "5099969209017" })`. Log in as `owner`, tap the link "Scan". Expect the status "Read 5099969209017", the textbox "Barcode" holding `5099969209017` and the heading "1 Release matches". Tap "Add to Collection". Expect "Added Gas 5 to your Collection.". Reload and expect the Gas 5 row with "Media VG+ · Sleeve VG+".
- **Camera on.** Film the barcode half out of view (`offset: [0.42, 0.05]`). Tap "Scan". Expect "Camera on" and "Hold the barcode inside the frame", and no read.
- **Camera blocked.** Same fake camera, but no `camera` permission. Tap "Scan". Expect the status starting "LP-Collection isn't allowed to use the camera.". Type `5099969209017` and tap "Look up". Expect "1 Release matches".
- **Camera off.** `e2e/scan-camera-off.spec.ts` checks the track ends when the User leaves `/lookup`. Report `camera-off` as covered by tests.

## Gotchas

- A real iPhone camera is not drivable here. iOS Safari, the home-screen app's permission prompt and real sleeves are the Owner's to check on the phone.
- Chromium plays the y4m file on a loop, so the barcode stays in view. A feed with a readable barcode reads within a frame or two, so take the "Camera on" screenshot with the half-in-view feed.
- Each Chromium launch reads one camera file. Use a new browser for each feed.
- Without the fake camera flags the headless shell answers `NotSupportedError`, which the screen shows as "The camera didn't start." This is what the older Lookup tests in `e2e/add-copy.spec.ts` see, and it does not affect typing.
- Chromium logs every 4xx answer to a fetch as a console error. The `401` from `/api/me` before login is expected.
