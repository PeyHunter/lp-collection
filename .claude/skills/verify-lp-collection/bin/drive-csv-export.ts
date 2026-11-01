import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, devices, expect } from "@playwright/test";

const runId = process.argv[2];
if (!runId) throw new Error("Usage: node .claude/skills/verify-lp-collection/bin/drive-csv-export.ts <run-id>");
const state = JSON.parse(await readFile(`.verify/${runId}/state.json`, "utf8")) as { appUrl: string };
const evidence = `.verify/${runId}/evidence`;
await mkdir(evidence, { recursive: true });
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
const browser = await chromium.launch();
const consoleErrors: string[] = [];
const context = await browser.newContext({ ...iPhone, baseURL: state.appUrl, acceptDownloads: true });
const page = await context.newPage();
page.on("console", (message) => message.type() === "error" && consoleErrors.push(`${page.url()} ${message.text()}`));
const exportLink = page.getByRole("link", { name: "Download as spreadsheet (CSV)" });

async function shot(name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  console.log(`saved ${name}.png`);
}

async function download(name: string) {
  const downloading = page.waitForEvent("download");
  await exportLink.click();
  const file = await downloading;
  await copyFile(await file.path(), `${evidence}/${name}.csv`);
  const bytes = await readFile(`${evidence}/${name}.csv`);
  console.log(`saved ${name}.csv as ${file.suggestedFilename()}, starts with bytes ${[...bytes.subarray(0, 3)].map((byte) => byte.toString(16)).join(" ")}`);
  console.log(bytes.toString("utf8"));
  return bytes.toString("utf8").replace(/^﻿/, "").split("\r\n");
}

await page.goto("/");
await page.getByRole("link", { name: "Log in with Discogs" }).click();
await page.getByLabel("Discogs username").fill("owner");
await page.getByRole("button", { name: "Authorize" }).click();
await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();

const me = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
const api = `/api/collections/${me.collection.id}`;
const ids: string[] = [];
for (const discogsReleaseId of [2474032, 16893476, 13716287]) {
  const created = await page.request.post(`${api}/copies`, { data: { discogsReleaseId } });
  expect(created.status()).toBe(201);
  ids.push(((await created.json()) as { copy: { id: string } }).copy.id);
}
await page.request.patch(`${api}/copies/${ids[0]}`, { data: { note: "Købt på Ærø, \"næsten\" ny", purchasePrice: { amount: 100, currency: "DKK" }, purchaseDate: "2019-03-12" } });

await page.goto("/");
await expect(page.getByRole("region", { name: "Copies" }).getByRole("link")).toHaveCount(3);
await exportLink.scrollIntoViewIfNeeded();
await shot("collection-export-link");

const withValues = await download("collection-values-on");
expect(withValues[0]).toBe("Artist,Title,Label,Catalog number,Original year,Pressing year,Media condition,Sleeve condition,Value,Lowest listing,Currency,Purchase price,Purchase currency,Gain,Note");
expect(withValues.filter(Boolean)).toHaveLength(4);
expect(withValues.join("\n")).toContain('"Købt på Ærø, ""næsten"" ny"');

await page.getByRole("switch", { name: "Values" }).click();
await expect(page.getByRole("switch", { name: "Values" })).not.toBeChecked();
const withoutValues = await download("collection-values-off");
expect(withoutValues[0]).toBe("Artist,Title,Label,Catalog number,Original year,Pressing year,Media condition,Sleeve condition,Note");
await exportLink.scrollIntoViewIfNeeded();
await shot("collection-export-values-off");

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
