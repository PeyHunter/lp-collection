import { mkdir, writeFile } from "node:fs/promises";
import { chromium, devices, expect, type Page } from "@playwright/test";
import { readState } from "./shared.ts";

const state = await readState(process.argv[2]);
const evidence = `.verify/${state.runId}/evidence`;
await mkdir(evidence, { recursive: true });
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
const browser = await chromium.launch();
const consoleErrors: string[] = [];

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${name}.png` });
  console.log(`saved ${name}.png`);
}

async function logIn(page: Page, username: string, from = "/") {
  await page.goto(from);
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill(username);
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
}

const owner = await (await browser.newContext({ ...iPhone, baseURL: state.appUrl })).newPage();
await logIn(owner, "owner");
const invite = (await (await owner.request.post("/api/invites")).json()) as { url: string };

const context = await browser.newContext({ ...iPhone, baseURL: state.appUrl });
const page = await context.newPage();
page.on("console", (message) => message.type() === "error" && consoleErrors.push(`${page.url()} ${message.text()}`));
await logIn(page, "with-discogs-collection-demo", new URL(invite.url).pathname);

// The notice is a polite live region, not a status, so it doesn't clash with the Collection's own status messages.
const progress = page.getByText(/Importing your Discogs collection/);
await expect(progress).toBeVisible();
console.log("while it runs:", await progress.textContent());
await shot(page, "import-running");

await expect(page.getByRole("region", { name: "Overview" })).toContainText("250 Copies", { timeout: 20_000 });
await expect(progress).toHaveCount(0);
await shot(page, "import-done");
const me = await page.request.get("/api/me");
await writeFile(`${evidence}/me-after-import.http.txt`, `GET /api/me\nHTTP ${me.status()}\n${await me.text()}\n`);
console.log("after:", JSON.stringify(((await me.json()) as { discogsImport: unknown }).discogsImport));

const again = await (await browser.newContext({ ...iPhone, baseURL: state.appUrl })).newPage();
await logIn(again, "with-discogs-collection-demo");
await expect(again.getByRole("region", { name: "Overview" })).toContainText("250 Copies");
await expect(again.getByText("Importing your Discogs collection")).toHaveCount(0);
console.log("logging in again: still 250 Copies, no second import");

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
