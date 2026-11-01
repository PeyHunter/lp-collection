import { execFileSync } from "node:child_process";
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
const historySection = page.getByRole("region", { name: "Value history" });

async function shot(name: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage });
  console.log(`saved ${name}.png`);
}

function refresh(name: string) {
  const output = execFileSync(process.execPath, [".claude/skills/verify-lp-collection/bin/refresh.ts", state.runId], { encoding: "utf8" });
  console.log(output.trim());
  return writeFile(`${evidence}/${name}.txt`, output).then(() => output);
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

await page.goto(`/copies/${ids[0]}`);
await expect(page.getByRole("region", { name: "Value", exact: true })).toContainText(/\d kr/);
await expect(historySection).toHaveCount(0);
await shot("copy-before-refresh");

expect(await refresh("refresh-first-run")).toMatch(/: 3 Values fetched, 1 Collection values recorded, month finished\./);
await page.reload();
await expect(historySection.getByRole("listitem")).toHaveCount(1);
await historySection.evaluate((section) => section.scrollIntoView({ block: "center" }));
// The tab bar is fixed, so a full-page shot taken after scrolling would draw it over the section.
await shot("copy-after-refresh", false);
const answer = await page.request.get(`${api}/copies/${ids[0]}`);
await writeFile(`${evidence}/copy-after-refresh.http.txt`, `GET ${api}/copies/${ids[0]}\nHTTP ${answer.status()}\n${await answer.text()}\n`);

expect(await refresh("refresh-same-month")).toMatch(/: 0 Values fetched, 0 Collection values recorded, month finished\./);
await page.reload();
await expect(historySection.getByRole("listitem")).toHaveCount(1);
console.log("a second run in the same month adds nothing");

await page.getByRole("switch", { name: "Values" }).click();
await expect(historySection).toHaveCount(0);
await shot("copy-values-off");
await page.getByRole("switch", { name: "Values" }).click();

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
