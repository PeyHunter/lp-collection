---
name: verify-lp-collection
description: Launch the real LP-Collection app (Hono API + React phone UI on a throwaway PostgreSQL), drive it at iPhone size like a user, and capture proof. Use to prove a change to LP-Collection works in the running app, not only in tests, before calling a ticket or PR done.
---

# Verify LP-Collection

LP-Collection is one Node app: a JSON API under `/api` and a React phone UI, served from the same port. Users touch the phone UI in mobile Safari; the API is the secondary surface. The launcher starts the app with `DISCOGS=fake`, so Discogs is replaced by the fake gateway (`src/server/fake-discogs.ts`): a Lookup finds only its few sample Releases, and "Log in with Discogs" goes to a Fake Discogs page where you type any Discogs username. The launcher names `owner` as the app's Owner (`APP_OWNER_DISCOGS_USERNAME`), so logging in as `owner` needs no Invite.

All commands run from the repo root. Every run has a run id; everything it keeps lives in `.verify/<run-id>/` (gitignored).

## Launch

Start the launcher in the background and wait for its `READY` line:

```sh
mkdir -p .verify && node .claude/skills/verify-lp-collection/bin/launch.ts <run-id> > .verify/<run-id>.log 2>&1 &
# wait until the log contains: READY <run-id> http://localhost:<port>
```

It runs `npm run build`, starts a fresh PostgreSQL on a free port in a new temp dir, starts `node src/server/main.ts` against it (which runs migrations), and prints `READY` only after `/api/health` answers `{"status":"ok"}`. The URL and ports are in `.verify/<run-id>/state.json`. Pick a new run id per run; runs never share ports or data, so several can run side by side.

If the log shows `app exited early` or `app never became healthy` instead, read the log above that line. The launcher has already cleaned up after itself.

## Doctor

Run it first, and again whenever anything looks off:

```sh
node .claude/skills/verify-lp-collection/bin/doctor.ts <run-id>
```

Exit 0 and a last line of `HEALTHY` mean: the launcher is alive, `/api/health` reports the database ok, the page is the LP-Collection page, and HEAD is still the commit that was built. `UNHEALTHY` lists what failed. A HEAD mismatch means you are about to verify old code: stop and relaunch. Never drive an instance this run did not launch.

## Drive

- **Phone UI:** `node .claude/skills/verify-lp-collection/bin/look.ts <run-id> <path> <name>` opens `<path>` in Chromium with the iPhone 15 profile (screen size, touch, mobile user agent), waits for the network to settle, prints the accessibility snapshot, and saves evidence. For interactions it does not cover (tapping, typing), write a short Playwright script next to the feature's evidence, using `devices["iPhone 15"]` and role/name locators (`getByRole("button", { name: "…" })`), and keep the script with the evidence.
- **API:** `curl -s -i <appUrl>/api/...`, with `appUrl` from `state.json`. Save the full response (`-i`) into the evidence folder.

Features and their exact recipes are in [`features/README.md`](features/README.md). Read the matching file before driving.

## Evidence

`look.ts` writes `.verify/<run-id>/evidence/<name>.png`, `<name>.aria.txt` and `<name>.json` (URL, HTTP status, title, console errors, commit). Save curl output there as `<name>.http.txt`.

Proof standards:
- Drive the real user path: the UI or the public `/api` routes. Never seed through internal functions or test-only routes.
- Capture the action and the resulting state, and for anything that saves data, a second read-only view showing it was stored (reload the page, or GET it back).
- Console errors in `<name>.json` must be empty unless the feature expects one.
- The fake Discogs is the only allowed mock, because the Discogs gateway is a real production boundary.
- Report what you verified with the run id and commit, and list any entry point from the feature map you did not drive.

## Cleanup

```sh
node .claude/skills/verify-lp-collection/bin/stop.ts <run-id>
rm -f .verify/<run-id>.log
```

It signals only the launcher this run started. The launcher stops the app, then PostgreSQL, then deletes the temp database dir. `.verify/<run-id>/evidence/` is kept. Never kill processes by name (`pkill node`, `pkill postgres`): other runs and the test suite may be using them.

## Helpers

All helpers are in `.claude/skills/verify-lp-collection/bin/` and run with plain `node` (Node 24+ runs TypeScript directly). The type check covers them (`npm run typecheck`).

| Script | Args | Does |
|---|---|---|
| `launch.ts` | `[run-id]` | build, fresh PostgreSQL, app; prints `READY <run-id> <url>` |
| `doctor.ts` | `<run-id>` | read-only health and build check; `HEALTHY` / `UNHEALTHY` |
| `look.ts` | `<run-id> <path> <name>` | iPhone-size screenshot, accessibility snapshot, console errors |
| `stop.ts` | `<run-id>` | orderly teardown, keeps evidence |
| `drive-value.ts` | `<run-id>` | drives the Value recipe in `features/value.md` on a fresh run and saves its screenshots |
| `drive-photos.ts` | `<run-id>` | drives the Photos recipe in `features/photos.md` on a fresh run and saves its screenshots and HTTP answers |
| `drive-lookup-fallbacks.ts` | `<run-id>` | walks the Lookup fallbacks and the duplicate warning, see [features/add-copy.md](features/add-copy.md) |
| `drive-copy-details.ts` | `<run-id>` | drives the Copy details recipe in `features/copy-details.md` on a fresh run and saves its screenshots and HTTP answers |
| `drive-search-sort.ts` | `<run-id>` | drives the recipe in `features/search-sort.md` on a fresh run and saves its screenshots |
| `drive-shelf.ts` | `<run-id>` | drives the Shelf recipe in `features/shelf.md` on a fresh run and saves its screenshots and HTTP answers |

Playwright's Chromium must be installed once: `npx playwright install chromium`.
