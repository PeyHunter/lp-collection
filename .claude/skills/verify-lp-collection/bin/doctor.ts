// Read-only: is this run's instance worth driving? Exits 0 and prints "HEALTHY" only if every check passes.
// Usage: node .claude/skills/verify-lp-collection/bin/doctor.ts <run-id>
import { execSync } from "node:child_process";
import { readState } from "./shared.ts";

const state = await readState(process.argv[2]);
const problems: string[] = [];

try {
  process.kill(state.launcherPid, 0);
} catch {
  problems.push(`launcher pid ${state.launcherPid} is not running`);
}

const health = await fetch(`${state.appUrl}/api/health`).then(async (r) => ({ status: r.status, body: await r.json() }), (e) => ({ status: 0, body: String(e) }));
if (health.status !== 200 || health.body?.status !== "ok" || health.body?.database !== "ok") {
  problems.push(`/api/health answered ${health.status} ${JSON.stringify(health.body)}`);
}

const page = await fetch(state.appUrl).then((r) => r.text(), () => "");
if (!page.includes("<title>LP-Collection</title>")) problems.push(`${state.appUrl} does not serve the LP-Collection page`);

const head = execSync("git rev-parse HEAD").toString().trim();
if (head !== state.commit) problems.push(`launched at ${state.commit.slice(0, 7)} but HEAD is now ${head.slice(0, 7)}; relaunch to verify HEAD`);

console.log(JSON.stringify({ ...state, health }, null, 2));
if (state.dirty) console.log("note: launched from a checkout with uncommitted changes");
if (problems.length) {
  console.log(`UNHEALTHY\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("HEALTHY");
