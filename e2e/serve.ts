import { join } from "node:path";
import { startThrowawayPostgres } from "../test/support/throwaway-postgres.ts";

// Starts a throwaway PostgreSQL, then the real server against it, for Playwright.
const postgres = await startThrowawayPostgres("e2e-pg");
await postgres.createDatabase("lp_collection");

process.env.APP_OWNER_DISCOGS_USERNAME ??= "owner";
process.env.DISCOGS = "fake";
process.env.PHOTOS_DIR = join(postgres.dir, "photos");
process.env.DATABASE_URL = `${postgres.url}/lp_collection`;
await import("../src/server/main.ts");
