import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, devices, expect, type APIResponse, type Page } from "@playwright/test";

const runId = process.argv[2];
if (!runId) throw new Error("Usage: node .claude/skills/verify-lp-collection/bin/drive-copy-details.ts <run-id>");
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
  if (scrollTo) await page.getByRole("region", { name: scrollTo }).evaluate((region) => region.scrollIntoView({ block: "start" }));
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))));
  await page.screenshot({ path: `${evidence}/${name}.png` });
  console.log(`saved ${name}.png`);
}

async function saveHttp(name: string, response: APIResponse) {
  const headers = Object.entries(response.headers())
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const body = response.status() === 204 ? "" : JSON.stringify(await response.json(), null, 2);
  await writeFile(`${evidence}/${name}.http.txt`, `HTTP ${response.status()}\n${headers}\n\n${body}\n`);
  console.log(`saved ${name}.http.txt (HTTP ${response.status()})`);
}

async function logIn(page: Page, username: string) {
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill(username);
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
}

const owner = await newPage();
await owner.goto("/");
await logIn(owner, "owner");
await owner.getByRole("link", { name: "Scan" }).click();
await owner.getByRole("textbox", { name: "Barcode" }).fill("190295328709");
await owner.getByRole("button", { name: "Look up" }).click();
await owner.getByRole("button", { name: "Add to Collection" }).click();
await expect(owner.getByRole("status")).toContainText("to your Collection.");
await owner.goto("/");
const rows = owner.getByRole("region", { name: "Copies" }).getByRole("listitem");
await rows.filter({ hasText: "Discovery" }).getByRole("link", { name: "Discovery" }).click();

const value = owner.getByRole("region", { name: "Value" });
const purchase = owner.getByRole("region", { name: "Purchase" });
const note = owner.getByRole("region", { name: "Note" });
await expect(value.locator(".amount")).toBeVisible();
await expect(value.locator(".amount")).toBeInViewport({ ratio: 1 });
await expect(value).not.toContainText("Gain");
await shot(owner, "copy-without-purchase");

await purchase.getByLabel("Purchase price").fill("149,95");
await purchase.getByLabel("Purchase date").fill("2019-03-12");
await purchase.getByRole("button", { name: "Save purchase" }).click();
await expect(purchase.getByRole("status")).toHaveText("The purchase saved.");
await expect(value.locator(".gain-figure.up")).toContainText("Gain +");
await expect(value).toContainText("Paid 150 kr on 12 Mar 2019");
await shot(owner, "purchase-section", "Purchase");
await owner.reload();
await expect(value.locator(".gain-figure.up")).toBeInViewport({ ratio: 1 });
await expect(purchase.getByLabel("Purchase price")).toHaveValue("149,95");
await expect(purchase.getByLabel("Purchase date")).toHaveValue("2019-03-12");
await shot(owner, "copy-gain-positive");

await note.getByRole("textbox", { name: "Note" }).fill("From Dad's shelf. Small seam split on the back, plays clean.");
await note.getByRole("button", { name: "Save note" }).click();
await expect(note.getByRole("status")).toHaveText("The note saved.");
await owner.reload();
await expect(note.getByRole("textbox", { name: "Note" })).toHaveValue("From Dad's shelf. Small seam split on the back, plays clean.");
await shot(owner, "note-saved", "Note");

await purchase.getByLabel("Purchase price").fill("1.200");
await purchase.getByRole("button", { name: "Save purchase" }).click();
await expect(value.locator(".gain-figure.down")).toContainText("Gain −");
await shot(owner, "copy-gain-negative");

await purchase.getByLabel("Purchase price").fill("20");
await purchase.getByLabel("Purchase currency").selectOption("EUR");
await purchase.getByRole("button", { name: "Save purchase" }).click();
await expect(value).toContainText("Paid 20 € on 12 Mar 2019, converted at today's ECB rate");
await shot(owner, "copy-gain-converted");

await purchase.getByLabel("Purchase price").fill("twelve");
await purchase.getByRole("button", { name: "Save purchase" }).click();
await expect(purchase.getByRole("alert")).toHaveText("The purchase wasn't saved. Type the price as a number, such as 149,95.");
await shot(owner, "purchase-typo", "Purchase");

const me = (await (await owner.request.get("/api/me")).json()) as { collection: { id: string } };
const copyId = owner.url().split("/copies/")[1]!;
const copyUrl = `/api/collections/${me.collection.id}/copies/${copyId}`;
await saveHttp("copy-with-details", await owner.request.get(copyUrl));
const future = await owner.request.patch(copyUrl, { data: { purchaseDate: "2999-01-01" } });
expect(future.status()).toBe(400);
await saveHttp("future-date-refused", future);

await purchase.getByRole("button", { name: "Clear" }).click();
await expect(purchase.getByRole("status")).toHaveText("The purchase saved.");
await note.getByRole("textbox", { name: "Note" }).fill("");
await note.getByRole("button", { name: "Save note" }).click();
await expect(note.getByRole("status")).toHaveText("The note saved.");
await owner.reload();
await expect(value).not.toContainText("Gain");
await expect(value).not.toContainText("Paid");
await expect(purchase.getByLabel("Purchase price")).toHaveValue("");
await expect(note.getByRole("textbox", { name: "Note" })).toHaveValue("");
await saveHttp("copy-cleared", await owner.request.get(copyUrl));

await owner.goto("/");
await owner.getByRole("button", { name: "Create Invite" }).click();
const inviteUrl = await owner.getByLabel("Invite link").inputValue();
const friend = await newPage();
await friend.goto(inviteUrl);
await logIn(friend, `friend-${runId}`);
const notMember = await friend.request.patch(copyUrl, { data: { note: "Mine now" } });
expect(notMember.status()).toBe(404);
await saveHttp("details-as-non-member", notMember);
const loggedOut = await browser.newContext({ baseURL: state.appUrl });
await saveHttp("details-logged-out", await loggedOut.request.patch(copyUrl, { data: { note: "Mine now" } }));

await rows.filter({ hasText: "Discovery" }).getByRole("link", { name: "Discovery" }).click();
await owner.getByRole("button", { name: "Delete this Copy" }).click();
const confirm = owner.getByRole("group", { name: "Delete Discovery? This can't be undone." });
await expect(confirm.getByRole("button", { name: "Delete Copy" })).toBeInViewport();
await shot(owner, "delete-copy-confirm", "Delete this Copy");
await confirm.getByRole("button", { name: "Delete Copy" }).click();
await expect(owner.getByRole("status")).toHaveText("Deleted Discovery from your Collection.");
await expect(rows).toHaveCount(0);
await shot(owner, "collection-after-delete");
const gone = await owner.request.get(copyUrl);
expect(gone.status()).toBe(404);
await saveHttp("copy-after-delete", gone);

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
