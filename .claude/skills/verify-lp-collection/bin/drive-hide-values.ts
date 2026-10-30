import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, devices, expect, type APIResponse } from "@playwright/test";

const runId = process.argv[2];
if (!runId) throw new Error("Usage: node .claude/skills/verify-lp-collection/bin/drive-hide-values.ts <run-id>");
const state = JSON.parse(await readFile(`.verify/${runId}/state.json`, "utf8")) as { appUrl: string };
const evidence = `.verify/${runId}/evidence`;
await mkdir(evidence, { recursive: true });
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
const browser = await chromium.launch();
const consoleErrors: string[] = [];
const context = await browser.newContext({ ...iPhone, baseURL: state.appUrl });
const page = await context.newPage();
page.on("console", (message) => message.type() === "error" && consoleErrors.push(`${page.url()} ${message.text()}`));

const valueText = /\d\s*kr|Value|Gain|Lowest listing|Purchase|Paid|Currency|seller settings/i;
const valueFields = /"(value|gain|lowestListing|purchasePrice|purchaseDate|sellerSettingsMissing)"/;
const valuesSwitch = page.getByRole("switch", { name: "Values" });
const copies = page.getByRole("region", { name: "Copies" });

async function shot(name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
  console.log(`saved ${name}.png`);
}

async function keep(name: string, request: string, response: APIResponse) {
  const text = await response.text();
  await writeFile(`${evidence}/${name}.http.txt`, `${request}\nHTTP ${response.status()}\n${text}\n`);
  return text;
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
const kindOfBlue = ids[0]!;
await page.request.patch(`${api}/copies/${kindOfBlue}`, { data: { purchasePrice: { amount: 100, currency: "DKK" }, purchaseDate: "2019-03-12" } });

await page.goto("/");
await expect(copies.getByRole("listitem").first()).toContainText(/\d kr/);
await expect(valuesSwitch).toBeChecked();
const copyBefore = await keep("copy-values-on", `GET ${api}/copies/${kindOfBlue}`, await page.request.get(`${api}/copies/${kindOfBlue}`));
await shot("collection-values-on");

await valuesSwitch.click();
await expect(valuesSwitch).not.toBeChecked();
await expect(copies.getByRole("link")).toHaveCount(3);
await expect(page.locator("main")).not.toContainText(valueText);
console.log("sort chips with Values off:", await page.getByRole("group", { name: "Sort by" }).getByRole("radio").evaluateAll((radios) => radios.map((radio) => radio.parentElement?.textContent)));
await shot("collection-values-off");

await page.reload();
await expect(valuesSwitch).not.toBeChecked();
await expect(copies.getByRole("link")).toHaveCount(3);
await expect(page.locator("main")).not.toContainText(valueText);
console.log("after reload the switch stays off");

const listOff = await keep("list-values-off", `GET ${api}/copies`, await page.request.get(`${api}/copies`));
const copyOff = await keep("copy-values-off", `GET ${api}/copies/${kindOfBlue}`, await page.request.get(`${api}/copies/${kindOfBlue}`));
const byValue = await page.request.get(`${api}/copies?sort=value`);
await keep("sort-by-value-off", `GET ${api}/copies?sort=value`, byValue);
const valuesOff = await keep("values-fetch-off", `POST ${api}/values`, await page.request.post(`${api}/values`, { data: { retryEmpty: true } }));
expect(listOff).not.toMatch(valueFields);
expect(copyOff).not.toMatch(valueFields);
expect(byValue.status()).toBe(400);
expect(JSON.parse(valuesOff)).toEqual({ more: false });
console.log("API with Values off: no Value field in the list or the Copy, sort by Value is 400, the Value fetch answers", valuesOff);

await copies.getByRole("link", { name: "Kind Of Blue" }).click();
await expect(page.getByRole("region", { name: "Note" })).toBeVisible();
await expect(page.locator("main")).not.toContainText(valueText);
await shot("copy-values-off");

await valuesSwitch.click();
await expect(page.getByRole("region", { name: "Value" })).toContainText("Paid 100 kr on 12 Mar 2019");
await shot("copy-values-on");
const copyAfter = await keep("copy-values-back-on", `GET ${api}/copies/${kindOfBlue}`, await page.request.get(`${api}/copies/${kindOfBlue}`));
expect(copyAfter).toEqual(copyBefore);
console.log("switching back on gives the same Copy answer, fetched at the same time:", JSON.parse(copyAfter).copy.value.fetchedAt);

await page.getByRole("link", { name: "Back" }).click();
await expect(copies.getByRole("listitem").first()).toContainText(/\d kr/);
await expect(page.getByLabel("Currency")).toBeVisible();
await shot("collection-values-back-on");

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
