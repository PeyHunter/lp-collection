import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, inject } from "vitest";
import { createApp } from "../../src/server/app.ts";
import { connectDatabase, migrate } from "../../src/server/db.ts";
import { createFakeDiscogs, type FakeDiscogsScript } from "../../src/server/fake-discogs.ts";
import { createSecretBox } from "../../src/server/secret-box.ts";

export type TestAppOptions = {
  discogs?: FakeDiscogsScript;
  appOwnerDiscogsUsername?: string;
  publicUrl?: string;
};

export type LoginResult = {
  session: string | undefined;
  setCookie: string | null;
  location: string | null;
};

/**
 * Starts the app against a brand-new PostgreSQL database and a scripted fake Discogs.
 * Tests talk to it only through `request`, the same HTTP API the phone UI uses.
 */
export async function createTestApp({ discogs: script = {}, appOwnerDiscogsUsername = "app-owner", publicUrl = "http://localhost" }: TestAppOptions = {}) {
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
  let secretBox = createSecretBox(randomBytes(32));
  let owner = appOwnerDiscogsUsername;
  const start = () => createApp({ database, discogs, secretBox, now: () => now, appOwnerDiscogsUsername: owner, publicUrl: new URL(publicUrl) });
  let app = start();

  afterAll(() => database.close());

  const request = (path: string, init?: RequestInit) => app.request(path, init);

  return {
    database,
    databaseUrl: `${serverUrl}/${name}`,
    discogs,
    get secretBox() {
      return secretBox;
    },
    restart(changes: { appOwnerDiscogsUsername?: string; tokenEncryptionKey?: Buffer }) {
      owner = changes.appOwnerDiscogsUsername ?? owner;
      if (changes.tokenEncryptionKey) secretBox = createSecretBox(changes.tokenEncryptionKey);
      app = start();
    },
    async query<Row extends Record<string, unknown>>(text: string, values: unknown[] = []) {
      const client = new pg.Client({ connectionString: `${serverUrl}/${name}` });
      await client.connect();
      try {
        return (await client.query<Row>(text, values)).rows;
      } finally {
        await client.end();
      }
    },
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
    async startLogin({ invite, headers }: { invite?: string; headers?: Record<string, string> } = {}) {
      const start = await request(invite === undefined ? "/api/login" : `/api/login?invite=${encodeURIComponent(invite)}`, { headers });
      const authorizeUrl = start.headers.get("location");
      const loginCookie = cookieFrom(start, "lp_login");
      const cookie = [headers?.cookie, loginCookie].filter(Boolean).join("; ");
      return {
        start,
        authorizeUrl,
        finish: (discogsUsername: string) => request(discogs.authorizeAs(authorizeUrl!, discogsUsername), { headers: { ...headers, cookie } }),
      };
    },
    async logIn(discogsUsername: string, options: { invite?: string; headers?: Record<string, string> } = {}): Promise<LoginResult> {
      const login = await this.startLogin(options);
      if (login.start.status !== 302 || !login.authorizeUrl?.startsWith("/fake-discogs/")) {
        return { session: undefined, setCookie: null, location: login.authorizeUrl };
      }
      const callback = await login.finish(discogsUsername);
      const setCookie = callback.headers.getSetCookie().find((cookie) => cookie.startsWith("lp_session=")) ?? null;
      return { session: setCookie?.split(";")[0], setCookie, location: callback.headers.get("location") };
    },
  };
}

export function cookieFrom(response: Response, name: string) {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`))?.split(";")[0];
}

export const days = (count: number) => count * 24 * 60 * 60 * 1000;
