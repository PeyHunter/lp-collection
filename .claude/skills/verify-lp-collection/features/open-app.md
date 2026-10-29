# Open the app

A user opens LP-Collection in their phone's browser and sees the app named at the top of a phone-sized page.

## Sub-features

- `open-home` shows the LP-Collection heading on the home screen.
- `open-deep-link` serves the same app for any non-API path, so a reload on a sub-page never shows a 404.

## How to get to it (user POV)

- Open the app's address (`/`) in the phone's browser.
- Reload while on any other page of the app.

## Driving it with verify-lp-collection

Preconditions:

- Baseline state, `doctor.ts` reports `HEALTHY`.

- **Home screen.** Open `/`. Run `node .claude/skills/verify-lp-collection/bin/look.ts <run-id> / home`. The snapshot contains `heading "LP-Collection" [level=1]`, `home.json` shows status `200`, title `LP-Collection` and no console errors, and `home.png` shows the heading on a phone-width page.
- **Deep link.** Open a path the API does not own. Run `node .claude/skills/verify-lp-collection/bin/look.ts <run-id> /some/page deep-link`. The result is the same as the home screen: status `200` and the same heading.

## Gotchas

- `look.ts` serves the build made at launch. A UI change after launch is not visible until you relaunch; `doctor.ts` flags a new commit but not uncommitted edits.
- Chromium with the iPhone profile stands in for mobile Safari. It catches layout and behavior problems, not Safari-only bugs.
