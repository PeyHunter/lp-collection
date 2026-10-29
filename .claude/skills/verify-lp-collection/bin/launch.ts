// Starts a throwaway PostgreSQL and the real built app against it, for one verification run.
// Usage (from the repo root, in the background): node .claude/skills/verify-lp-collection/bin/launch.ts [run-id]
// Prints "READY <run-id> <url>" once the app answers a healthy /api/health. stop.ts (SIGUSR2) tears it all down.
import { execSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { freePort } from "../../../../test/support/free-port.ts";
import { evidenceDir, statePath, type RunState } from "./shared.ts";

const runId = process.argv[2] ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;

await mkdir(evidenceDir(runId), { recursive: true });
execSync("npm run build", { stdio: ["ignore", "ignore", "inherit"] });

const postgresPort = await freePort();
const appPort = await freePort();
const dataDir = await mkdtemp(join(tmpdir(), `lp-collection-verify-${runId}-`));
// A fresh random password per run: the database is throwaway and nothing secret is committed.
const password = randomUUID();
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password, port: postgresPort, persistent: false, onLog: () => {} });
await pg.initialise();
await pg.start();
await pg.createDatabase("lp_collection");

const app = spawn("node", ["src/server/main.ts"], {
  env: { ...process.env, PORT: String(appPort), DATABASE_URL: `postgres://postgres:${password}@localhost:${postgresPort}/lp_collection` },
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
  await pg.stop();
  await rm(dataDir, { recursive: true, force: true });
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
  postgresPort,
  commit: execSync("git rev-parse HEAD").toString().trim(),
  dirty: execSync("git status --porcelain").toString().trim() !== "",
  startedAt: new Date().toISOString(),
};
await writeFile(statePath(runId), JSON.stringify(state, null, 2));
console.log(`READY ${runId} ${appUrl}`);
