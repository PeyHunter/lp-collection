import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, inject } from "vitest";
import { createApp } from "../../src/server/app.ts";
import { connectDatabase, migrate } from "../../src/server/db.ts";
import { createFakeDiscogs, type FakeDiscogsScript } from "../../src/server/fake-discogs.ts";

/**
 * Starts the app against a brand-new PostgreSQL database and a scripted fake Discogs.
 * Tests talk to it only through `request`, the same HTTP API the phone UI uses.
 */
export async function createTestApp(script: FakeDiscogsScript = {}) {
  const serverUrl = inject("postgresUrl");
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: `${serverUrl}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const database = connectDatabase(`${serverUrl}/${name}`);
  await migrate(database);
  const discogs = createFakeDiscogs(script);
  const app = createApp({ database, discogs });

  afterAll(() => database.close());

  return {
    discogs,
    /** Cuts every connection the app holds, as a PostgreSQL restart would. */
    async dropDatabaseConnections() {
      const admin = new pg.Client({ connectionString: `${serverUrl}/postgres` });
      await admin.connect();
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [name]);
      await admin.end();
    },
    request: (path: string, init?: RequestInit) => app.request(path, init),
  };
}
