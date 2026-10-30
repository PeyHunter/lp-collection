// Drives the Lookup fallbacks and the duplicate warning at iPhone 15 size on a fresh run, as the Owner.
// Usage: node .claude/skills/verify-lp-collection/bin/drive-lookup-fallbacks.ts <run-id>
// Writes numbered screenshots and accessibility snapshots, lookup-catalog-number.http.txt and console-errors.txt to evidence/.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, devices, expect, type Locator, type Page } from "@playwright/test";
import { evidenceDir, readState } from "./shared.ts";

const { runId, appUrl } = await readState(process.argv[2]);
const evidence = evidenceDir(runId);
mkdirSync(evidence, { recursive: true });
const consoleErrors: string[] = [];

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 15"], baseURL: appUrl });
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(`${page.url()} ${message.text()}`);
});

async function shot(page: Page, name: string, focus: Locator) {
  await focus.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${evidence}/${name}.png` });
  writeFileSync(`${evidence}/${name}.aria.txt`, await page.locator("main").ariaSnapshot());
  console.log(`saved ${name}`);
}

await page.goto("/");
await page.getByRole("link", { name: "Log in with Discogs" }).click();
await page.getByLabel("Discogs username").fill("owner");
await page.getByRole("button", { name: "Authorize" }).click();
await expect(page.getByText("No Copies yet.")).toBeVisible();

await page.getByRole("link", { name: "Scan" }).click();
await page.getByRole("textbox", { name: "Barcode" }).fill("4006381333931");
await page.getByRole("button", { name: "Look up" }).click();
const barcodeMiss = page.getByText("No Release on Discogs has the barcode 4006381333931.");
await expect(barcodeMiss).toBeVisible();
await shot(page, "1-barcode-no-match", page.getByRole("button", { name: "Search by Catalog number" }));

await page.getByRole("button", { name: "Search by Catalog number" }).click();
await expect(page.getByRole("textbox", { name: "Catalog number" })).toBeFocused();
await page.getByRole("textbox", { name: "Catalog number" }).fill("PCS 7099");
await page.getByRole("button", { name: "Look up" }).click();
await expect(page.getByText("No Release on Discogs has the Catalog number PCS 7099.")).toBeVisible();
await shot(page, "2-catalog-number-no-match", page.getByRole("radio", { name: "Catalog number" }));

await page.getByRole("button", { name: "Search by artist and title" }).click();
await expect(page.getByRole("textbox", { name: "Artist" })).toBeFocused();
await page.getByRole("textbox", { name: "Artist" }).fill("Beatles");
await page.getByRole("textbox", { name: "Title" }).fill("Sgt Pepper");
await page.getByRole("button", { name: "Look up" }).click();
await expect(page.getByRole("heading", { name: "2 Releases match" })).toBeVisible();
await shot(page, "3-artist-and-title-matches", page.getByRole("heading", { name: "2 Releases match" }));

const uk = page.getByRole("listitem").filter({ hasText: "1967 · UK · Parlophone · PCS 7027" });
await uk.getByRole("button", { name: "Sgt. Pepper's Lonely Hearts Club Band" }).click();
await uk.getByRole("button", { name: "Add to Collection" }).click();
await expect(page.getByRole("status")).toHaveText("Added Sgt. Pepper's Lonely Hearts Club Band to your Collection.");
await shot(page, "4-added-from-artist-and-title", page.getByRole("status"));

await page.getByRole("link", { name: "Scan" }).click();
await page.getByRole("radio", { name: "Catalog number" }).check();
await page.getByRole("textbox", { name: "Catalog number" }).fill("pcs 7027");
await page.getByRole("button", { name: "Look up" }).click();
const pepper = page.getByRole("listitem").filter({ hasText: "PCS 7027" });
await expect(pepper.getByRole("alert")).toHaveText("You already have 1 Copy of this. Add another?");
await shot(page, "5-duplicate-warning-1-copy", pepper);

await pepper.getByRole("button", { name: "Cancel" }).click();
await expect(pepper.getByRole("alert")).toHaveCount(0);
await shot(page, "6-duplicate-cancelled", pepper);

await pepper.getByRole("button", { name: "Sgt. Pepper's Lonely Hearts Club Band" }).click();
await pepper.getByRole("button", { name: "Add another" }).click();
await expect(page.getByRole("status")).toHaveText("Added Sgt. Pepper's Lonely Hearts Club Band to your Collection.");
await expect(page.getByRole("listitem").filter({ hasText: "Sgt. Pepper" })).toHaveCount(2);

await page.reload();
await expect(page.getByRole("listitem").filter({ hasText: "Sgt. Pepper" })).toHaveCount(2);
await shot(page, "7-two-copies-after-reload", page.getByRole("listitem").filter({ hasText: "Sgt. Pepper" }).first());

await page.getByRole("link", { name: "Scan" }).click();
await page.getByRole("radio", { name: "Artist and title" }).check();
await page.getByRole("textbox", { name: "Artist" }).fill("The Beatles");
await page.getByRole("button", { name: "Look up" }).click();
const ukAgain = page.getByRole("listitem").filter({ hasText: "PCS 7027" });
await ukAgain.getByRole("button", { name: "Sgt. Pepper's Lonely Hearts Club Band" }).click();
await expect(ukAgain.getByRole("alert")).toHaveText("You already have 2 Copies of this. Add another?");
await expect(page.getByRole("listitem").filter({ hasText: "SHZE 401" })).not.toContainText("In your Collection");
await shot(page, "8-duplicate-warning-2-copies", ukAgain);

const me = (await (await context.request.get("/api/me")).json()) as { collection: { id: string } };
const api = await context.request.get(`/api/collections/${me.collection.id}/lookup?catalogNumber=PCS%207027`);
writeFileSync(`${evidence}/lookup-catalog-number.http.txt`, `HTTP ${api.status()}\n${JSON.stringify(await api.json(), null, 2)}\n`);

writeFileSync(`${evidence}/console-errors.txt`, consoleErrors.join("\n"));
console.log(`console errors: ${consoleErrors.length}`);
await browser.close();
