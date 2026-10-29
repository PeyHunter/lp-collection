// Tears down one run's app and PostgreSQL by signalling the launcher it started. Keeps .verify/<run-id>/ (the evidence).
// Usage: node .claude/skills/verify-lp-collection/bin/stop.ts <run-id>
import { readState } from "./shared.ts";

const state = await readState(process.argv[2]);
const alive = () => {
  try {
    process.kill(state.launcherPid, 0);
    return true;
  } catch {
    return false;
  }
};

if (!alive()) {
  console.log(`run ${state.runId} is already stopped`);
  process.exit(0);
}
// SIGUSR2, not SIGTERM: embedded-postgres stops PostgreSQL by itself on SIGTERM, before the app has shut down.
process.kill(state.launcherPid, "SIGUSR2");
for (let i = 0; i < 100 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
if (alive()) {
  console.error(`launcher pid ${state.launcherPid} did not exit; inspect it before doing anything else`);
  process.exit(1);
}
console.log(`stopped run ${state.runId}; evidence kept in .verify/${state.runId}/evidence`);
