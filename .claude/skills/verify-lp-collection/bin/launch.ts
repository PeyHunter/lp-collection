// Starts a throwaway PostgreSQL and the real built app against it, for one verification run.
// Usage (from the repo root, in the background): node .claude/skills/verify-lp-collection/bin/launch.ts [run-id]
// Prints "READY <run-id> <url>" once the app answers a healthy /api/health. stop.ts (SIGUSR2) tears it all down.
import { execSync, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { freePort } from "../../../../test/support/free-port.ts";
import { startThrowawayPostgres } from "../../../../test/support/throwaway-postgres.ts";
import { evidenceDir, statePath, type RunState } from "./shared.ts";

const runId = process.argv[2] ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;

await mkdir(evidenceDir(runId), { recursive: true });
execSync("npm run build", { stdio: ["ignore", "ignore", "inherit"] });

const appPort = await freePort();
const postgres = await startThrowawayPostgres(`verify-${runId}`);
await postgres.createDatabase("lp_collection");

const app = spawn("node", ["src/server/main.ts"], {
  env: { APP_OWNER_DISCOGS_USERNAME: "owner", ...process.env, DISCOGS: "fake", PORT: String(appPort), DATABASE_URL: `${postgres.url}/lp_collection` },
  stdio: ["ignore", "inherit", "inherit"],
});

let tearingDown = false;
async function teardown(code: number) {
  if (tearingDown) return;
  tearingDown = true;
  if (app.exitCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve));
    app.kill("SIGTERM");
    await exited;
  }
  await postgres.stop();
  process.exit(code);
}
process.on("SIGUSR2", () => teardown(0));
process.on("SIGTERM", () => teardown(0));
process.on("SIGINT", () => teardown(0));
app.once("exit", (code) => {
  if (tearingDown) return;
  console.error(`app exited early with code ${code}`);
  teardown(1);
});

const appUrl = `http://localhost:${appPort}`;
for (let attempt = 0; ; attempt++) {
  const body = await fetch(`${appUrl}/api/health`).then((r) => r.json(), () => null);
  if (body?.status === "ok") break;
  if (attempt > 100) {
    console.error("app never became healthy");
    await teardown(1);
  }
  await new Promise((r) => setTimeout(r, 200));
}

const state: RunState = {
  runId,
  launcherPid: process.pid,
  appUrl,
  commit: execSync("git rev-parse HEAD").toString().trim(),
  dirty: execSync("git status --porcelain").toString().trim() !== "",
  startedAt: new Date().toISOString(),
};
await writeFile(statePath(runId), JSON.stringify(state, null, 2));
console.log(`READY ${runId} ${appUrl}`);
