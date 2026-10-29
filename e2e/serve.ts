import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { freePort } from "../test/support/free-port.ts";

// Starts a throwaway PostgreSQL, then the real server against it, for Playwright.
const port = await freePort();
const password = randomUUID();
const pg = new EmbeddedPostgres({
  databaseDir: await mkdtemp(join(tmpdir(), "lp-collection-e2e-pg-")),
  user: "postgres",
  password,
  port,
  persistent: false,
  onLog: () => {},
});
await pg.initialise();
await pg.start();
await pg.createDatabase("lp_collection");
process.on("SIGTERM", () => pg.stop().then(() => process.exit(0)));

process.env.DATABASE_URL = `postgres://postgres:${password}@localhost:${port}/lp_collection`;
await import("../src/server/main.ts");
