import { mkdir, writeFile } from "node:fs/promises";
import { chromium, devices, expect } from "@playwright/test";
import { readState } from "./shared.ts";

const state = await readState(process.argv[2]);
const evidence = `.verify/${state.runId}/evidence`;
await mkdir(evidence, { recursive: true });
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
const browser = await chromium.launch();
const consoleErrors: string[] = [];
const context = await browser.newContext({ ...iPhone, baseURL: state.appUrl });
const page = await context.newPage();
page.on("console", (message) => message.type() === "error" && consoleErrors.push(`${page.url()} ${message.text()}`));
const overview = page.getByRole("region", { name: "Overview" });

async function shot(name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${name}.png` });
  console.log(`saved ${name}.png`);
}

await page.goto("/");
await page.getByRole("link", { name: "Log in with Discogs" }).click();
await page.getByLabel("Discogs username").fill("owner");
await page.getByRole("button", { name: "Authorize" }).click();
await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
await expect(overview).toContainText("0 Copies");
await shot("overview-empty");

const me = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
const api = `/api/collections/${me.collection.id}`;
for (const discogsReleaseId of [2474032, 16893476, 13716287, 2335811, 7371225, 3133906, 1046716]) {
  expect((await page.request.post(`${api}/copies`, { data: { discogsReleaseId } })).status()).toBe(201);
}
await page.goto("/");
await expect(overview).toContainText("7 Copies");
const mostValuable = overview.getByRole("region", { name: "Most valuable" });
console.log("most valuable:", await mostValuable.getByRole("link").allTextContents());
console.log("overview:", (await overview.locator(".overview-figures").textContent())?.trim());
await shot("overview");
const answer = await page.request.get(`${api}/overview`);
await writeFile(`${evidence}/overview.http.txt`, `GET ${api}/overview\nHTTP ${answer.status()}\n${await answer.text()}\n`);

const first = (await mostValuable.getByRole("link").first().textContent())!;
await mostValuable.getByRole("link").first().click();
await expect(page.getByRole("heading", { name: first })).toBeVisible();
console.log(`tapping ${first} opens its Copy`);
await page.getByRole("link", { name: "Back" }).click();

await page.getByRole("switch", { name: "Values" }).click();
await expect(overview).not.toContainText(/kr|Most valuable/);
await shot("overview-values-off");
const hidden = await page.request.get(`${api}/overview`);
await writeFile(`${evidence}/overview-values-off.http.txt`, `GET ${api}/overview\nHTTP ${hidden.status()}\n${await hidden.text()}\n`);
await page.getByRole("switch", { name: "Values" }).click();

await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Scan" }).click();
await expect(page).toHaveURL(/\/lookup$/);
console.log("the dock's Scan opens the camera Lookup");

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
