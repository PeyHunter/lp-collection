import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { freePort } from "./free-port.ts";

/**
 * Starts a PostgreSQL server in a new lp-collection-<name>-* folder in the temp dir.
 * stop() deletes the folder. If this process ends without calling stop(), even by SIGKILL,
 * a detached reaper stops the server and deletes the folder.
 */
export async function startThrowawayPostgres(name: string) {
  const dir = await mkdtemp(join(tmpdir(), `lp-collection-${name}-`));
  spawn(process.execPath, [join(import.meta.dirname, "reap-postgres.ts"), String(process.pid), dir], { detached: true, stdio: "ignore" }).unref();
  const port = await freePort();
  const password = randomUUID();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password,
    port,
    persistent: false,
    // Clients connect over TCP. Without this PostgreSQL writes its socket lock file to /tmp whatever TMPDIR says.
    postgresFlags: ["-c", "unix_socket_directories="],
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  return {
    url: `postgres://postgres:${password}@localhost:${port}`,
    createDatabase: (database: string) => pg.createDatabase(database),
    stop: async () => {
      await pg.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
