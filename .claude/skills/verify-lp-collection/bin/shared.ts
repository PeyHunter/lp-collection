import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Everything a run keeps lives under .verify/<run-id>/ in the repo; stop.ts never deletes it. */
export const runDir = (runId: string) => join(".verify", runId);
export const statePath = (runId: string) => join(runDir(runId), "state.json");
export const evidenceDir = (runId: string) => join(runDir(runId), "evidence");

export type RunState = {
  runId: string;
  launcherPid: number;
  appUrl: string;
  postgresPort: number;
  commit: string;
  dirty: boolean;
  startedAt: string;
};

export async function readState(runId: string | undefined): Promise<RunState> {
  if (!runId) throw new Error("Pass the run id that launch.ts printed.");
  return JSON.parse(await readFile(statePath(runId), "utf8"));
}
