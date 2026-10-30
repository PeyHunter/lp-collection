import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { freePort } from "./support/free-port.ts";

const scratch: string[] = [];
afterEach(() => Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

async function eventually(check: () => Promise<boolean>, timeoutMs: number) {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return check();
}

test("the e2e server leaves no PostgreSQL folder behind when Playwright kills it", { timeout: 60_000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "throwaway-postgres-test-"));
  scratch.push(temp);
  const port = await freePort();
  const server = spawn(process.execPath, ["e2e/serve.ts"], { env: { ...process.env, TMPDIR: temp, PORT: String(port) }, detached: true, stdio: "ignore" });
  const healthy = await eventually(() => fetch(`http://localhost:${port}/api/health`).then((r) => r.ok, () => false), 20_000);
  expect(healthy, "the e2e server started").toBe(true);
  expect(await readdir(temp)).toContainEqual(expect.stringMatching(/^lp-collection-/));

  process.kill(-server.pid!, "SIGKILL");

  const leftovers = async () => (await readdir(temp)).filter((name) => name.startsWith("lp-collection-"));
  expect(await eventually(async () => (await leftovers()).length === 0, 10_000), `left behind: ${await leftovers()}`).toBe(true);
});
