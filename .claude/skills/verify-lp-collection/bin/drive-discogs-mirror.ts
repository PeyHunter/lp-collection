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
  const me = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  return `/api/collections/${me.collection.id}`;
}

async function keep(page: Page, name: string, path: string) {
  const response = await page.request.get(path);
  const text = await response.text();
  await writeFile(`${evidence}/${name}.http.txt`, `GET ${path}\nHTTP ${response.status()}\n${text}\n`);
  return JSON.parse(text) as { notSyncedYet: string[] | boolean };
}

const ownerContext = await browser.newContext({ ...iPhone, baseURL: state.appUrl });
const owner = await ownerContext.newPage();
owner.on("console", (message) => message.type() === "error" && consoleErrors.push(`${owner.url()} ${message.text()}`));
const ownerApi = await logIn(owner, "owner");
const invite = (await (await owner.request.post("/api/invites")).json()) as { url: string };

for (const discogsReleaseId of [2474032, 16893476]) expect((await owner.request.post(`${ownerApi}/copies`, { data: { discogsReleaseId } })).status()).toBe(201);
await expect.poll(async () => (await keep(owner, "owner-list", `${ownerApi}/copies`)).notSyncedYet).toEqual([]);
await owner.goto("/");
await expect(owner.getByRole("region", { name: "Copies" }).getByRole("listitem")).toHaveCount(2);
await expect(owner.locator("main")).not.toContainText("Not synced");
console.log("owner: both Copies synced to Discogs, no marker");
await shot(owner, "synced-collection");

const refusedContext = await browser.newContext({ ...iPhone, baseURL: state.appUrl });
const refused = await refusedContext.newPage();
refused.on("console", (message) => message.type() === "error" && consoleErrors.push(`${refused.url()} ${message.text()}`));
const refusedApi = await logIn(refused, "no-collection-sync-demo", new URL(invite.url).pathname);
expect((await refused.request.post(`${refusedApi}/copies`, { data: { discogsReleaseId: 2474032 } })).status()).toBe(201);
await refused.goto("/");
const row = refused.getByRole("region", { name: "Copies" }).getByRole("listitem").filter({ hasText: "Kind Of Blue" });
await expect(row).toContainText("Not synced to Discogs yet");
console.log("a User whose Discogs collection refuses changes: the Copy is saved and marked");
await shot(refused, "not-synced-row");
await keep(refused, "not-synced-list", `${refusedApi}/copies`);
await row.getByRole("link", { name: "Kind Of Blue" }).click();
await expect(refused.getByText(/Not synced to Discogs yet/)).toBeVisible();
await shot(refused, "not-synced-copy");

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
