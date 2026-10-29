import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import exitHook from "async-exit-hook";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";
import { freePort } from "./free-port.ts";

// embedded-postgres installs async-exit-hook: its beforeExit handler calls process.exit(0), which
// erases vitest's failure exit code, and its exit handler throws. Teardown below stops the server
// instead; the signal handlers stay so Ctrl-C still stops it.
exitHook.unhookEvent("beforeExit");
exitHook.unhookEvent("exit");

// One real PostgreSQL server for the whole test run; each test file gets its own fresh database.
export default async function setup(project: TestProject) {
  const port = await freePort();
  const password = randomUUID();
  const dir = await mkdtemp(join(tmpdir(), "lp-collection-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password,
    port,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  project.provide("postgresUrl", `postgres://postgres:${password}@localhost:${port}`);

  return async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}
