// Runs the monthly refresh once against a launched run, as the CronJob does: node src/server/main.ts refresh.
// Usage: node .claude/skills/verify-lp-collection/bin/refresh.ts <run-id>
import { execFileSync } from "node:child_process";
import { readState } from "./shared.ts";

const state = await readState(process.argv[2]);
const output = execFileSync(process.execPath, ["src/server/main.ts", "refresh"], {
  env: { PATH: process.env.PATH ?? "", APP_OWNER_DISCOGS_USERNAME: "owner", DISCOGS: "fake", ...state.refreshEnv },
  encoding: "utf8",
});
process.stdout.write(output);
