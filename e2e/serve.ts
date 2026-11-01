import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startThrowawayPostgres } from "../test/support/throwaway-postgres.ts";
import { refreshEnvPath } from "./refresh.ts";

// Starts a throwaway PostgreSQL, then the real server against it, for Playwright.
const postgres = await startThrowawayPostgres("e2e-pg");
await postgres.createDatabase("lp_collection");

process.env.APP_OWNER_DISCOGS_USERNAME ??= "owner";
process.env.DISCOGS = "fake";
process.env.PHOTOS_DIR = join(postgres.dir, "photos");
process.env.DATABASE_URL = `${postgres.url}/lp_collection`;
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
// Specs that run the monthly refresh as its own process (e2e/refresh.ts) read the database and token key from here.
await mkdir("test-results", { recursive: true });
await writeFile(refreshEnvPath, JSON.stringify({ DATABASE_URL: process.env.DATABASE_URL, TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY }));
await import("../src/server/main.ts");
