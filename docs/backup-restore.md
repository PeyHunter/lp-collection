# Backups and restoring them

## What is backed up, and where

Every night at 02:30 the `lp-collection-backup` CronJob (`deploy/backup.yaml`) runs the app image on **k3s-1**, the node the app and PostgreSQL do not run on, with `node src/server/backup-cli.ts backup`. It writes into the `lp-collection-backups` volume (local-path, 20 GiB) at `/var/backups/lp-collection`:

```
db/2026-11-02.jsonl.gz      every table, gzipped JSON lines, one consistent snapshot
db/2026-11-02.photos.json   the Photo files that night names
photos/<file key>.jpg       each Photo once, shared by every night that names it
```

- The database dump reads PostgreSQL over the cluster network. It covers every table in the `public` schema in foreign-key order, read from the catalog, so new tables are included without changing the backup. Its first line names the format and how many migrations the database had.
- Photos are copied from the app over the cluster network, from `GET /internal/backup/photos/<file key>` on the app. That route only exists when the app has `BACKUP_TOKEN`. It needs that token, and refuses anything that came through the Cloudflare tunnel. Only Photos the backup doesn't have yet are fetched.
- A night only counts once its Photos are safe. A backup that fails halfway leaves no night behind, and the Job retries.
- Nights older than 30 days are deleted (the newest is always kept), along with Photos no remaining night names.

`BACKUP_TOKEN` lives in the `lp-collection-backup` secret, which `scripts/wizard/deploy.sh` creates.

## Checking the backups

```sh
kubectl -n lp-collection get cronjob lp-collection-backup
kubectl -n lp-collection logs job/$(kubectl -n lp-collection get jobs -o name | grep backup | tail -1 | cut -d/ -f2)
```

A good night logs: `Backed up N rows from 18 tables to /var/backups/lp-collection/db/<day>.jsonl.gz, and P Photos (n new). Removed …`.

## Restoring into an empty database

A restore loads one night into a database that has just been migrated and holds nothing. It refuses anything else. Use the **same app image** that made the backup: the dump names its migration count, and the restore stops if the database differs. The restored database also needs the same `TOKEN_ENCRYPTION_KEY` (in `lp-collection-discogs`), or the stored Discogs tokens can't be opened, and the app refuses to start until they are cleared.

1. Stop the app, so nothing writes while you restore:
   `kubectl -n lp-collection scale deployment lp-collection --replicas=0`
2. Empty the database. Drop and recreate it as `postgres` in the PostgreSQL pod:
   `kubectl -n lp-collection exec -it postgres-0 -- psql -U lp_collection -d postgres -c 'drop database lp_collection' -c 'create database lp_collection'`
3. Run the restore on k3s-1, next to the backups, with the image tag the backup was made with:
   ```sh
   kubectl -n lp-collection run lp-collection-restore --rm -it --restart=Never \
     --image=ghcr.io/peyhunter/lp-collection:sha-<commit> \
     --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"k3s-1"},"securityContext":{"runAsUser":1000,"runAsGroup":1000},
       "containers":[{"name":"lp-collection-restore","image":"ghcr.io/peyhunter/lp-collection:sha-<commit>",
       "command":["node","src/server/backup-cli.ts","restore","/var/backups/lp-collection/db/<day>.jsonl.gz"],
       "env":[{"name":"POSTGRES_PASSWORD","valueFrom":{"secretKeyRef":{"name":"lp-collection-db","key":"POSTGRES_PASSWORD"}}},
              {"name":"DATABASE_URL","value":"postgres://lp_collection:$(POSTGRES_PASSWORD)@postgres:5432/lp_collection"},
              {"name":"BACKUP_DIR","value":"/var/backups/lp-collection"}],
       "volumeMounts":[{"name":"backups","mountPath":"/var/backups/lp-collection"}]}],
       "volumes":[{"name":"backups","persistentVolumeClaim":{"claimName":"lp-collection-backups"}}]}}' \
     --labels=app=lp-collection-backup
   ```
   The label lets the pod through the network policy to PostgreSQL. It prints the rows per table, then how many Photos still need copying.
4. Copy the Photos to the app's volume on k3s-2. The backups and the Photos are on different nodes, so copy them through your computer. Start the app again first, so there is a pod with the Photos volume:
   ```sh
   kubectl -n lp-collection scale deployment lp-collection --replicas=1
   BACKUP_POD=… # a pod mounting lp-collection-backups, e.g. a paused copy of the step-3 pod
   kubectl -n lp-collection cp $BACKUP_POD:/var/backups/lp-collection/photos ./photos
   kubectl -n lp-collection cp ./photos/. deploy/lp-collection:/var/lib/lp-collection/photos
   ```
   The backup keeps 30 days of Photos, so copy only the files `db/<day>.photos.json` names if you restore an older night.

Outside the cluster (one computer, one disk), set `PHOTOS_DIR` in step 3 and the restore copies the Photos itself.

## The restore, tested once

Run on 2026-11-02 against a throwaway PostgreSQL 18 and the real app from the `verify-lp-collection` launcher. The app held two Users, two Copies and one Photo taken through the app. The backup fetched the Photo over HTTP with `BACKUP_TOKEN`, and the restore went into a new, empty database:

```
$ node src/server/backup-cli.ts backup
Backed up 25 rows from 18 tables to BACKUP_DIR/db/2026-11-02.jsonl.gz, and 1 Photos (1 new). Removed 0 nights older than 30 days and 0 Photos no night names.
$ node src/server/backup-cli.ts backup   (again: the Photo is already there)
Backed up 25 rows from 18 tables to BACKUP_DIR/db/2026-11-02.jsonl.gz, and 1 Photos (0 new). Removed 0 nights older than 30 days and 0 Photos no night names.
$ node src/server/backup-cli.ts backup   (wrong token)
The backup failed: The app answered photo 2a692e216a624fddfcb49e3ab60842f2 with HTTP 401
exit 1

$ node src/server/backup-cli.ts restore BACKUP_DIR/db/<day>.jsonl.gz   (into a new, empty database)
Restored 25 rows and 1 Photos from BACKUP_DIR/db/2026-11-02.jsonl.gz.
  app_owner: 1
  barcode_lookup_cache: 2
  releases: 2
  users: 2
  collections: 2
  invites: 2
  sessions: 5
  discogs_imports: 2
  memberships: 2
  copies: 2
  photos: 1
  value_snapshots: 2

$ node src/server/backup-cli.ts restore … again (the database is no longer empty)
The restore failed: The database already holds app_owner. Restore only into an empty database.
exit 1

Row counts, original vs restored:
  lp_collection {"users":"2","copies":"2","photos":"1","snapshots":"2","sessions":"5"}
  lp_collection_restored2 {"users":"2","copies":"2","photos":"1","snapshots":"2","sessions":"5"}
Photo files restored: 1; identical to the app's: yes
```

`test/api/backup.test.ts` repeats this on every test run. It restores into an empty database, then checks that the restored app gives the same Collection answer, serves the same Photo bytes, and keeps everyone logged in. It also covers pruning, the token and tunnel guards, and that a half-done backup leaves no night behind.

The steps 1–4 in the cluster have **not** been run: this repo never touches the cluster. Try them once on the first real night's backup.
