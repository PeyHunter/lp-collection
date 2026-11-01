import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const refreshEnvPath = join(import.meta.dirname, "../test-results/e2e-refresh-env.json");

/** Runs the monthly refresh once against the e2e server's database, as the CronJob does. */
export function runRefresh() {
  const env = JSON.parse(readFileSync(refreshEnvPath, "utf8")) as Record<string, string>;
  return execFileSync(process.execPath, ["src/server/main.ts", "refresh"], {
    env: { PATH: process.env.PATH ?? "", APP_OWNER_DISCOGS_USERNAME: "owner", DISCOGS: "fake", ...env },
    encoding: "utf8",
  });
}
