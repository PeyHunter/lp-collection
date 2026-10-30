import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, devices, expect, type Page } from "@playwright/test";

const runId = process.argv[2];
if (!runId) throw new Error("Usage: node .claude/skills/verify-lp-collection/bin/drive-search-sort.ts <run-id>");
const state = JSON.parse(await readFile(`.verify/${runId}/state.json`, "utf8")) as { appUrl: string };
const evidence = `.verify/${runId}/evidence`;
await mkdir(evidence, { recursive: true });
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
const browser = await chromium.launch();
const consoleErrors: string[] = [];
const context = await browser.newContext({ ...iPhone, baseURL: state.appUrl });
const page = await context.newPage();
page.on("console", (message) => message.type() === "error" && consoleErrors.push(`${page.url()} ${message.text()}`));

async function shot(name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("group", { name: "Sort by" }).evaluate((sort) => sort.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `${evidence}/${name}.png` });
  console.log(`saved ${name}.png`);
}

async function add(barcode: string, pick?: string) {
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill(barcode);
  await page.getByRole("button", { name: "Look up" }).click();
  if (pick) await page.getByRole("listitem").filter({ hasText: pick }).getByRole("button", { name: "Kind Of Blue" }).click();
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toContainText("to your Collection.");
}

const sortBy = (label: string) => page.getByRole("group", { name: "Sort by" }).getByText(label, { exact: true }).click();
const copiesRegion = page.getByRole("region", { name: "Copies" });
const rows = copiesRegion.getByRole("listitem");
const titles = async () => (await copiesRegion.getByRole("link").allInnerTexts()).map((title) => title.trim());
const headings = async () => (await copiesRegion.getByRole("heading").allInnerTexts()).map((heading) => heading.replaceAll("\n", " ").toLowerCase());

await page.goto("/");
await page.getByRole("link", { name: "Log in with Discogs" }).click();
await page.getByLabel("Discogs username").fill("owner");
await page.getByRole("button", { name: "Authorize" }).click();
await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
for (const [barcode, pick] of [
  ["5099969209017"],
  ["886979891211", "Sony Music"],
  ["886979891211", "CS 8163"],
  ["190295328709"],
  ["602577915062"],
  ["5099924015813"],
  ["5099906406616"],
] as [string, string?][]) {
  await add(barcode, pick);
}

await page.goto("/");
await expect(rows).toHaveCount(7);
expect(await titles()).toEqual(["Trans-Europe Express", "Hounds Of Love", "Discovery", "Abbey Road", "Kind Of Blue", "Kind Of Blue", "Gas 5"]);
await expect(rows.first()).toContainText("615 kr");
await expect(rows.filter({ hasText: "Abbey Road" })).toContainText("1969 · pressed 2019 · Apple Records · PCS 7088");
console.log("value high first:", await headings());
await shot("sort-value-high");

await page.getByRole("button", { name: /Reverse the order/ }).click();
await expect(page.getByText("Low first. Copies with no Value always come last.")).toBeVisible();
await expect.poll(titles).toEqual(["Kind Of Blue", "Kind Of Blue", "Abbey Road", "Discovery", "Hounds Of Love", "Trans-Europe Express", "Gas 5"]);
console.log("value low first:", await headings());
await shot("sort-value-low");

await sortBy("Period");
await expect.poll(headings).toEqual(["the 50s 2 lps", "the 60s 1 lp", "the 70s 2 lps", "the 80s 1 lp", "the 00s 1 lp"]);
console.log("period:", await titles());
await shot("sort-period");

await sortBy("Artist");
await expect.poll(titles).toEqual(["Abbey Road", "Discovery", "Gas 5", "Hounds Of Love", "Trans-Europe Express", "Kind Of Blue", "Kind Of Blue"]);
console.log("artist:", await headings());

await page.getByRole("searchbox", { name: "Search the Collection" }).fill("miles");
await expect.poll(titles).toEqual(["Kind Of Blue", "Kind Of Blue"]);
await expect(page.getByText("2 LPs found")).toBeVisible();
await shot("search-miles");

await page.getByRole("searchbox", { name: "Search the Collection" }).fill("kab1");
await expect.poll(titles).toEqual(["Hounds Of Love"]);

await page.getByRole("searchbox", { name: "Search the Collection" }).fill("");
await page.getByRole("group", { name: "Genre" }).getByText("Electronic").click();
await expect.poll(titles).toEqual(["Discovery", "Hounds Of Love", "Trans-Europe Express"]);
await page.getByRole("group", { name: "Period" }).getByText("70s").click();
await expect.poll(titles).toEqual(["Trans-Europe Express"]);
await sortBy("Value");
await expect.poll(titles).toEqual(["Trans-Europe Express"]);
console.log("Electronic + 70s, by Value, address:", page.url());
await shot("filters-combined");

await page.reload();
await expect.poll(titles).toEqual(["Trans-Europe Express"]);
await expect(page.getByRole("group", { name: "Genre" }).getByRole("radio", { name: /Electronic/ })).toBeChecked();
console.log("after reload the search, sort and filters stay:", page.url());

await page.getByRole("group", { name: "Genre" }).getByText("Jazz").click();
await expect(page.getByText("No Copies match in the 70s in Jazz.")).toBeVisible();
await shot("no-match");
await page.getByRole("button", { name: "Show every Copy" }).click();
await expect(rows).toHaveCount(7);

const me = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
const api = await page.request.get(`/api/collections/${me.collection.id}/copies?q=electronic&sort=value&dir=asc&period=1980&limit=2`);
await writeFile(`${evidence}/search-sort.http.txt`, `GET /copies?q=electronic&sort=value&dir=asc&period=1980&limit=2\nHTTP ${api.status()}\n${JSON.stringify(await api.json(), null, 2)}\n`);

for (let saved = 0; saved < 60; saved++) {
  const response = await page.request.post(`/api/collections/${me.collection.id}/copies`, { data: { discogsReleaseId: 1503928 } });
  expect(response.status()).toBe(201);
}
await page.goto("/?sort=added");
await expect(rows).toHaveCount(50);
await expect(page.getByRole("button", { name: "Show more (17 left)" })).toBeVisible();
await page.getByRole("button", { name: /Show more/ }).scrollIntoViewIfNeeded();
await expect(rows).toHaveCount(67);
await expect(page.getByRole("button", { name: /Show more/ })).toHaveCount(0);
console.log("infinite scroll loaded every Copy:", await rows.count());
await shot("more-loaded");

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
