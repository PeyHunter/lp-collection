// Backups of LP-Collection, run with the app image:
//   node src/server/backup-cli.ts backup          nightly, by the lp-collection-backup CronJob on the other node
//   node src/server/backup-cli.ts restore <file>  by hand, into an empty database; with PHOTOS_DIR set it copies the
//                                                 Photos there too (docs/backup-restore.md)
import { join } from "node:path";
import { pruneBackups, restoreBackup, writeBackup } from "./backup.ts";
import { connectDatabase, migrate } from "./db.ts";

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
  return value;
}

const [command, file] = process.argv.slice(2);
const database = connectDatabase(required("DATABASE_URL"));
const backupDir = required("BACKUP_DIR");
const now = () => new Date();

try {
  if (command === "backup") {
    const appUrl = required("APP_URL");
    const token = required("BACKUP_TOKEN");
    const result = await writeBackup({
      database,
      dir: backupDir,
      now,
      async fetchPhoto(fileKey) {
        const response = await fetch(`${appUrl}/internal/backup/photos/${fileKey}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`The app answered photo ${fileKey} with HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      },
    });
    const pruned = await pruneBackups(backupDir, now);
    console.log(
      `Backed up ${result.rows} rows from ${result.tables} tables to ${result.file}, and ${result.photos.kept} Photos (${result.photos.fetched} new). Removed ${pruned.nightsRemoved.length} nights older than 30 days and ${pruned.photosRemoved} Photos no night names.`,
    );
  } else if (command === "restore" && file) {
    await migrate(database);
    const result = await restoreBackup({ database, file, photosFrom: join(backupDir, "photos"), photosDir: process.env.PHOTOS_DIR || undefined });
    console.log(`Restored ${Object.values(result.rows).reduce((sum, count) => sum + count, 0)} rows and ${result.photos} Photos from ${file}.`);
    if (result.photosToCopy.length > 0) {
      console.log(`PHOTOS_DIR is not set, so ${result.photosToCopy.length} Photos still need copying from ${join(backupDir, "photos")} to the app's Photos (docs/backup-restore.md).`);
    }
    for (const [table, count] of Object.entries(result.rows)) console.log(`  ${table}: ${count}`);
  } else {
    console.error("Usage: node src/server/backup-cli.ts backup | restore <backup file>");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`The ${command} failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await database.close();
}
