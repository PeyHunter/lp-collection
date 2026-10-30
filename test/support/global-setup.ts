import exitHook from "async-exit-hook";
import type { TestProject } from "vitest/node";
import { startThrowawayPostgres } from "./throwaway-postgres.ts";

// embedded-postgres installs async-exit-hook: its beforeExit handler calls process.exit(0), which
// erases vitest's failure exit code, and its exit handler throws. Teardown below stops the server
// instead; the signal handlers stay so Ctrl-C still stops it.
exitHook.unhookEvent("beforeExit");
exitHook.unhookEvent("exit");

// One real PostgreSQL server for the whole test run; each test file gets its own fresh database.
export default async function setup(project: TestProject) {
  const postgres = await startThrowawayPostgres("pg");
  project.provide("postgresUrl", postgres.url);
  return postgres.stop;
}

declare module "vitest" {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}
