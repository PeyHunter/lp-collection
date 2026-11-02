# Home-screen app and nightly backups

LP-Collection installs on the iPhone home screen with its own record icon and opens full screen, without Safari's bars. A service worker lets it open with no connection, saying it can't reach the server. Every night the database and Photos are backed up to the other k3s node, keeping 30 days (docs/backup-restore.md).

## Sub-features

- `manifest`: `/manifest.webmanifest` (name "LP-Collection", short name "LPs", `display: standalone`, icons 192, 512 and 512 maskable in `/icons/`). iOS reads `apple-touch-icon` (180) and the `apple-mobile-web-app-*` tags in `index.html`. The icons are drawn from `scripts/icons/icon.svg` by `node scripts/icons/make-icons.ts`.
- `service-worker`: `/sw.js` takes over the whole app. Pages come from the network first, falling back to the cached app shell offline. `/assets`, `/fonts` and `/icons` come from the cache first, and `/api` is never cached.
- `backup`: `node src/server/backup-cli.ts backup` (CronJob `lp-collection-backup`, 02:30, on k3s-1) writes `db/<day>.jsonl.gz`, `db/<day>.photos.json` and `photos/`, and prunes nights older than 30 days.
- `restore`: `node src/server/backup-cli.ts restore <file>` loads a night into an empty database. It refuses one that holds anything, or is at another migration.
- `backup-route`: `GET /internal/backup/photos/<file key>` exists only with `BACKUP_TOKEN`. It answers `401` without the token and `403` for anything carrying `CF-Connecting-IP`.

## How to get to it (user POV)

- In Safari on the iPhone: Share, then "Add to Home Screen". The icon opens the app full screen.
- Backups have no screen. The Owner reads the CronJob's logs, and restores by hand.

## Driving it with verify-lp-collection

Preconditions: baseline state, `doctor.ts` reports `HEALTHY`. For the backup, launch with `BACKUP_TOKEN=<anything>` in the environment, so the app has the backup route.

- `curl -s <appUrl>/manifest.webmanifest` answers the manifest, and each icon in it answers `200 image/png`.
- `look.ts <run-id> / home` and then `navigator.serviceWorker.ready` in the page: the worker's scope is `/`.
- Backup and restore: follow "The restore, tested once" in docs/backup-restore.md. It uses `refreshEnv.DATABASE_URL` from `state.json`, creates an empty database next to it with `pg`, and runs `backup-cli.ts backup` then `restore`.

## Gotchas

- Chromium stands in for Safari. iOS ignores the manifest's icons and uses `apple-touch-icon`, which `e2e/home-screen-app.spec.ts` checks is served.
- Changing what the service worker caches: bump `version` in `sw.js`, so old caches are deleted.
- The cluster steps of a restore have not been run; see docs/backup-restore.md.
