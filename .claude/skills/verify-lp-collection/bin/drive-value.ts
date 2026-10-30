import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, devices, expect, type Page } from "@playwright/test";

const runId = process.argv[2];
if (!runId) throw new Error("Usage: node .claude/skills/verify-lp-collection/bin/drive-value.ts <run-id>");
const state = JSON.parse(await readFile(`.verify/${runId}/state.json`, "utf8")) as { appUrl: string };
const evidence = `.verify/${runId}/evidence`;
await mkdir(evidence, { recursive: true });
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
const browser = await chromium.launch();
const consoleErrors: string[] = [];

async function newPage() {
  const context = await browser.newContext({ ...iPhone, baseURL: state.appUrl });
  const page = await context.newPage();
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(`${page.url()} ${message.text()}`));
  return page;
}

async function shot(page: Page, name: string, scrollTo?: string) {
  if (scrollTo) await page.getByRole("region", { name: scrollTo }).scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${name}.png` });
  console.log(`saved ${name}.png`);
}

async function logIn(page: Page, username: string) {
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill(username);
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
}

async function add(page: Page, barcode: string, pick?: string) {
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill(barcode);
  await page.getByRole("button", { name: "Look up" }).click();
  if (pick) await page.getByRole("listitem").filter({ hasText: pick }).getByRole("button", { name: "Kind Of Blue" }).click();
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toContainText("to your Collection.");
}

const owner = await newPage();
await owner.goto("/");
await logIn(owner, "owner");
await add(owner, "5099969209017");
await add(owner, "886979891211", "Sony Music");
await add(owner, "190295328709");
await owner.goto("/");
const rows = owner.getByRole("region", { name: "Copies" }).getByRole("listitem");
await expect(rows).toHaveCount(3);
console.log("rows:", (await rows.allInnerTexts()).map((text) => text.replaceAll("\n", " | ")));
await expect(rows.filter({ hasText: "Discovery" })).toContainText("252 kr");
await expect(rows.filter({ hasText: "Gas 5" })).toContainText("No Value yet");
await shot(owner, "collection-values");

await rows.filter({ hasText: "Discovery" }).getByRole("link", { name: "Discovery" }).click();
const value = owner.getByRole("region", { name: "Value" });
await expect(value).toContainText("252 kr");
await expect(value).toContainText("Lowest listing 231 kr, any condition");
await shot(owner, "copy-page");

await owner.getByLabel("Media condition").selectOption("Near Mint (NM or M-)");
await expect(value).toContainText("336 kr");
await owner.getByLabel("Sleeve condition").selectOption("No Cover");
await expect(owner.getByLabel("Sleeve condition")).toBeEnabled();
await shot(owner, "copy-condition-changed", "Value");
await owner.reload();
await expect(owner.getByRole("region", { name: "Value" })).toContainText("336 kr");
await expect(owner.getByLabel("Sleeve condition")).toHaveValue("No Cover");
console.log("after reload: Value 336 kr, Media NM, Sleeve No Cover");

const me = (await (await owner.request.get("/api/me")).json()) as { collection: { id: string } };
const copies = await owner.request.get(`/api/collections/${me.collection.id}/copies`);
await writeFile(`${evidence}/copies.http.txt`, `HTTP ${copies.status()}\n${JSON.stringify(await copies.json(), null, 2)}\n`);

await owner.goto("/");
await owner.getByRole("button", { name: "Create Invite" }).click();
const inviteUrl = await owner.getByLabel("Invite link").inputValue();
const friend = await newPage();
await friend.goto(inviteUrl);
await friend.getByRole("link", { name: "Log in with Discogs" }).click();
await friend.getByLabel("Discogs username").fill("no-seller-settings");
await friend.getByRole("button", { name: "Authorize" }).click();
await add(friend, "190295328709");
await add(friend, "5099969209017");
const guide = friend.getByRole("region", { name: "Fill in your Discogs seller settings to see Values" });
await expect(guide).toBeVisible();
await expect(friend.getByText("No Value yet")).toHaveCount(0);
await friend.goto("/");
await shot(friend, "seller-settings-guide");
await friend.getByRole("region", { name: "Copies" }).getByRole("link", { name: "Discovery" }).click();
await expect(friend.getByRole("region", { name: "Fill in your Discogs seller settings to see Values" })).toBeVisible();
await shot(friend, "seller-settings-guide-copy", "Fill in your Discogs seller settings to see Values");

const [settings] = await Promise.all([
  friend.waitForEvent("popup"),
  friend.getByRole("link", { name: "Open seller settings on Discogs" }).click(),
]);
await settings.getByLabel("Discogs username").fill("no-seller-settings");
await settings.getByRole("button", { name: "Save seller settings" }).click();
await settings.close();
await friend.getByRole("button", { name: "I've saved them, fetch Values" }).click();
await expect(friend.getByRole("region", { name: "Value" })).toContainText("252 kr");
await friend.goto("/");
await expect(friend.getByRole("region", { name: "Copies" }).getByRole("listitem").filter({ hasText: "Discovery" })).toContainText("252 kr");
await expect(friend.getByRole("region", { name: "Copies" }).getByRole("listitem").filter({ hasText: "Gas 5" })).toContainText("No Value yet");
await shot(friend, "seller-settings-resolved");

await friend.getByLabel("Currency").selectOption("EUR");
await add(friend, "190295328709");
await friend.goto("/");
const euroRow = friend.getByRole("region", { name: "Copies" }).getByRole("listitem").first();
await expect(euroRow).toContainText("34 €");
console.log("after switching to EUR, newest Discovery row:", (await euroRow.innerText()).replaceAll("\n", " | "));

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
