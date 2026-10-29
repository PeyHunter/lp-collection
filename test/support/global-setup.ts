import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

const PORT = 54329;

// One real PostgreSQL server for the whole test run; each test file gets its own fresh database.
export default async function setup(project: TestProject) {
  const dir = await mkdtemp(join(tmpdir(), "lp-collection-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  project.provide("postgresUrl", `postgres://postgres:postgres@localhost:${PORT}`);

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
