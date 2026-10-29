// Opens a page of the run's app in Chromium at iPhone 15 size and saves what a user would see.
// Usage: node .claude/skills/verify-lp-collection/bin/look.ts <run-id> <path> <name>
// Writes evidence/<name>.png (screenshot), <name>.aria.txt (accessibility snapshot) and <name>.json (URL, HTTP status, console errors).
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, devices } from "@playwright/test";
import { evidenceDir, readState } from "./shared.ts";

const [runId, path = "/", name = "page"] = process.argv.slice(2);
const state = await readState(runId);
const out = join(evidenceDir(state.runId), name);

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 15"] });
const page = await context.newPage();
const consoleErrors: string[] = [];
page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
page.on("pageerror", (error) => consoleErrors.push(error.message));

const response = await page.goto(new URL(path, state.appUrl).href, { waitUntil: "networkidle" });
const aria = await page.locator("body").ariaSnapshot();
await page.screenshot({ path: `${out}.png`, fullPage: true });
await writeFile(`${out}.aria.txt`, aria + "\n");
await writeFile(`${out}.json`, JSON.stringify({ url: page.url(), status: response?.status(), title: await page.title(), consoleErrors, commit: state.commit }, null, 2));
await browser.close();

console.log(aria);
console.log(`saved ${out}.png, ${out}.aria.txt, ${out}.json`);
