# LP-Collection verification map

This folder is the maintained source for verifying what LP-Collection users can do. Read this index, then use the matching feature file as the recipe. When a ticket adds or changes a user-facing feature, update or add its file in the same PR.

## Baseline preconditions

- A run launched with `bin/launch.ts <run-id>` and `bin/doctor.ts <run-id>` reporting `HEALTHY`.
- The database is fresh: migrations applied, no Users, Collections or Copies.
- Discogs is the fake gateway (`DISCOGS=fake`), which knows a few sample Releases (`sampleReleases` in `src/server/fake-discogs.ts`). Its login page accepts any username, and `owner` is the app's Owner.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Use ARIA roles and accessible names (as printed by `look.ts`) rather than CSS selectors or positions.
- Drive the phone UI at iPhone 15 size. Use the API directly only for API entry points.
- Use the GLOSSARY.md terms (Copy, Release, Collection, Value) in reports.

## Proof and skip reporting

- UI proof: the `look.ts` screenshot, accessibility snapshot and JSON with no console errors.
- API proof: the full `curl -i` response.
- Saved data: a second, read-only view showing it was stored.
- Record the feature ID and entry point with each piece of evidence.
- Report an entry point you could not drive with the command you tried and the unmet precondition. Never report it as verified through a different path.

## Feature entry contract

Each feature file has an H1 title and one paragraph on the user-visible behavior, then exactly four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-lp-collection`, `Gotchas`.

## Features

- [Open the app](./open-app.md) covers the home screen a user sees on their phone.
- [Invite and log in](./invite-login.md) covers the app's Owner creating an Invite, the invited person logging in with Discogs into their own empty Collection, staying logged in, and logging out.
- [Add a Copy by typed barcode](./add-copy.md) covers the Lookup screen, picking one of several pressings, saving the Copy at Very Good Plus, and the Collection list.
- [Health check](./health.md) covers the status endpoint that tells whether the app and its database are up.
