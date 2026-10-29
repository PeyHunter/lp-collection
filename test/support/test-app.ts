import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, inject } from "vitest";
import { createApp } from "../../src/server/app.ts";
import { connectDatabase, migrate } from "../../src/server/db.ts";
import { createFakeDiscogs, type FakeDiscogsScript } from "../../src/server/fake-discogs.ts";

export type TestAppOptions = {
  discogs?: FakeDiscogsScript;
  appOwnerDiscogsUsername?: string;
};

export type LoginResult = {
  /** The `Cookie` header value to send as this User, or undefined when the login was refused. */
  session: string | undefined;
  setCookie: string | null;
  /** Where the app sent the browser at the end. */
  location: string | null;
};

/**
 * Starts the app against a brand-new PostgreSQL database and a scripted fake Discogs.
 * Tests talk to it only through `request`, the same HTTP API the phone UI uses.
 */
export async function createTestApp({ discogs: script = {}, appOwnerDiscogsUsername = "app-owner" }: TestAppOptions = {}) {
  const serverUrl = inject("postgresUrl");
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: `${serverUrl}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const database = connectDatabase(`${serverUrl}/${name}`);
  await migrate(database);
  const discogs = createFakeDiscogs(script);
  let now = new Date("2026-03-01T12:00:00Z");
  const app = createApp({ database, discogs, now: () => now, appOwnerDiscogsUsername });

  afterAll(() => database.close());

  const request = (path: string, init?: RequestInit) => app.request(path, init);

  return {
    discogs,
    appOwnerDiscogsUsername,
    clock: {
      advance(ms: number) {
        now = new Date(now.getTime() + ms);
      },
    },
    /** Cuts every connection the app holds, as a PostgreSQL restart would. */
    async dropDatabaseConnections() {
      const admin = new pg.Client({ connectionString: `${serverUrl}/postgres` });
      await admin.connect();
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [name]);
      await admin.end();
    },
    request,
    /** Walks the whole "Log in with Discogs" round trip as a browser would, typing `discogsUsername` on the fake Discogs page. */
    async logIn(discogsUsername: string, { invite, headers }: { invite?: string; headers?: Record<string, string> } = {}): Promise<LoginResult> {
      const start = await request(invite === undefined ? "/api/login" : `/api/login?invite=${encodeURIComponent(invite)}`, { headers });
      const authorizeUrl = start.headers.get("location");
      if (start.status !== 302 || !authorizeUrl?.startsWith("/fake-discogs/")) {
        return { session: undefined, setCookie: null, location: authorizeUrl };
      }
      const callback = await request(discogs.authorizeAs(authorizeUrl, discogsUsername), { headers });
      const setCookie = callback.headers.get("set-cookie");
      return { session: setCookie?.split(";")[0], setCookie, location: callback.headers.get("location") };
    },
  };
}

export const days = (count: number) => count * 24 * 60 * 60 * 1000;
