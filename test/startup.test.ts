import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

function startServer(env: Record<string, string>) {
  return spawnSync(process.execPath, ["src/server/main.ts"], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: "postgres://nobody@127.0.0.1:1/nothing", ...env },
    encoding: "utf8",
    timeout: 20_000,
  });
}

test("in production the app refuses to start without Discogs keys and says how to get them", () => {
  const result = startServer({ NODE_ENV: "production", APP_OWNER_DISCOGS_USERNAME: "owner" });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET are not set");
  expect(result.stderr).toContain("scripts/wizard/discogs.sh");
});

test("the app refuses to start without knowing who its Owner is", () => {
  const result = startServer({ APP_OWNER_DISCOGS_USERNAME: "" });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("APP_OWNER_DISCOGS_USERNAME is not set");
});

test("the app refuses to start with only half of the Discogs keys", () => {
  const result = startServer({ APP_OWNER_DISCOGS_USERNAME: "owner", DISCOGS_CONSUMER_KEY: "key-only" });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Set both DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET");
});

const discogsKeys = { DISCOGS_CONSUMER_KEY: "key", DISCOGS_CONSUMER_SECRET: "secret" };

test("in production the app refuses to start without its public URL", () => {
  const result = startServer({ NODE_ENV: "production", APP_OWNER_DISCOGS_USERNAME: "owner", ...discogsKeys });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("PUBLIC_URL is not set");
});

test("the app refuses to start with a public URL that is not a web address", () => {
  const result = startServer({ APP_OWNER_DISCOGS_USERNAME: "owner", ...discogsKeys, PUBLIC_URL: "lp-collection.example" });

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("PUBLIC_URL must be the address phones open");
});
