import { randomUUID } from "node:crypto";
import { devices, expect, test, type APIRequestContext, type Page } from "@playwright/test";

const { defaultBrowserType: _browser, ...iPhone } = devices["iPhone 15"];

// A login without an Invite counts against the logins one device may start, so this spec counts as a device of its own.
const ownDevice = { "cf-connecting-ip": "203.0.113.7" };

let owner: APIRequestContext;

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ ...iPhone, baseURL, extraHTTPHeaders: ownDevice });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill("owner");
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
  owner = context.request;
});

async function logInAsNewUser(page: Page) {
  const invite = await owner.post("/api/invites");
  expect(invite.ok()).toBe(true);
  const { url } = (await invite.json()) as { url: string };
  await page.goto(url);
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill(`collector-${randomUUID().slice(0, 8)}`);
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
}

test("a record with no barcode is found by falling back to the Catalog number, then the artist and title", async ({ page }) => {
  await logInAsNewUser(page);
  await page.getByRole("link", { name: "Scan" }).click();

  await page.getByRole("textbox", { name: "Barcode" }).fill("4006381333931");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("No Release on Discogs has the barcode 4006381333931.")).toBeVisible();
  await page.getByRole("button", { name: "Search by Catalog number" }).click();

  const catalogNumber = page.getByRole("textbox", { name: "Catalog number" });
  await expect(catalogNumber).toBeFocused();
  await catalogNumber.fill("PCS 7099");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("No Release on Discogs has the Catalog number PCS 7099.")).toBeVisible();
  await page.getByRole("button", { name: "Search by artist and title" }).click();

  await expect(page.getByRole("textbox", { name: "Artist" })).toBeFocused();
  await page.getByRole("textbox", { name: "Artist" }).fill("Beatles");
  await page.getByRole("textbox", { name: "Title" }).fill("Sgt Pepper");
  await page.getByRole("button", { name: "Look up" }).click();

  await expect(page.getByRole("heading", { name: "2 Releases match" })).toBeVisible();
  const uk = page.getByRole("listitem").filter({ hasText: "1967 · UK · Parlophone · PCS 7027" });
  await uk.getByRole("button", { name: "Sgt. Pepper's Lonely Hearts Club Band" }).click();
  await uk.getByRole("button", { name: "Add to Collection" }).click();

  await expect(page.getByRole("status")).toHaveText("Added Sgt. Pepper's Lonely Hearts Club Band to your Collection.");
});

test("picking a Release the Collection already has warns with the Copy count, and Cancel or Add another decide", async ({ page }) => {
  await logInAsNewUser(page);
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("radio", { name: "Catalog number" }).check();
  await page.getByRole("textbox", { name: "Catalog number" }).fill("CBS 69209");
  await page.getByRole("button", { name: "Look up" }).click();
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Gas 5 to your Collection.");

  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("radio", { name: "Catalog number" }).check();
  await page.getByRole("textbox", { name: "Catalog number" }).fill("cbs 69209");
  await page.getByRole("button", { name: "Look up" }).click();

  const gas5 = page.getByRole("listitem").filter({ hasText: "Gas 5" });
  await expect(gas5).toContainText("In your Collection");
  await expect(gas5.getByRole("alert")).toHaveText("You already have 1 Copy of this. Add another?");
  await gas5.getByRole("button", { name: "Cancel" }).click();
  await expect(gas5.getByRole("alert")).toHaveCount(0);
  await expect(gas5.getByRole("button", { name: "Add another" })).toHaveCount(0);

  await gas5.getByRole("button", { name: "Gas 5" }).click();
  await gas5.getByRole("button", { name: "Add another" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Gas 5 to your Collection.");
  await expect(page.getByRole("listitem").filter({ hasText: "Gas 5" })).toHaveCount(2);

  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill("5099969209017");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("alert")).toHaveText("You already have 2 Copies of this. Add another?");
});
