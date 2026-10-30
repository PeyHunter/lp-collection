// Started detached by startThrowawayPostgres. Usage: node reap-postgres.ts <owner-pid> <data-dir>
// Waits until the owner process is gone, then stops the PostgreSQL server in <data-dir> and deletes the folder.
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [owner, dir] = [Number(process.argv[2]), process.argv[3]!];

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

while (alive(owner) && existsSync(dir)) await sleep(500);
if (!existsSync(dir)) process.exit(0);

const postmaster = Number((await readFile(join(dir, "postmaster.pid"), "utf8").catch(() => "")).split("\n")[0]);
if (postmaster) {
  if (alive(postmaster)) process.kill(postmaster, "SIGINT");
  for (let i = 0; i < 50 && alive(postmaster); i++) await sleep(200);
  if (alive(postmaster)) process.kill(postmaster, "SIGKILL");
}
await rm(dir, { recursive: true, force: true });
