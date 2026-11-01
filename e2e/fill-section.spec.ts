import type { Page } from "@playwright/test";
import { expect, test } from "./login.ts";
import { drawShelfPhoto } from "./shelf-photo.ts";

async function add(page: Page, barcode: string) {
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill(barcode);
  await page.getByRole("button", { name: "Look up" }).click();
  await page.getByRole("button", { name: /^Add (to Collection|another)$/ }).first().click();
  await expect(page.getByRole("status")).toContainText("to your Collection.");
}

test("a User fills a Section by scanning: held records go in, a second Copy asks which, an unknown one is added", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "filler");
  await add(page, "190295328709");
  await add(page, "5099969209017");
  await add(page, "5099969209017");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shelves" }).click();
  await page.getByRole("link", { name: "Set up a Shelf" }).click();
  await page.getByLabel("Take or pick a photo").setInputFiles({ name: "shelf.jpg", mimeType: "image/jpeg", buffer: await drawShelfPhoto(page) });
  await page.getByLabel("Shelf name").fill("Shelf 1");
  await page.getByRole("button", { name: "Save Shelf" }).click();
  await page.getByRole("link", { name: "Shelf 1" }).click();
  await page.getByRole("link", { name: "Fill B2, 0 Copies" }).click();
  await expect(page.getByRole("heading", { name: "Shelf 1 · B2" })).toBeVisible();

  const barcode = page.getByRole("textbox", { name: "Barcode" });
  const counter = page.getByRole("status").filter({ hasText: "placed in B2" });
  await barcode.fill("190295328709");
  await page.getByRole("button", { name: "Place", exact: true }).click();
  await expect(page.getByText("Put Discovery in Shelf 1 · B2. Scan the next one.")).toBeVisible();
  await expect(counter).toHaveText("1 placed in B2");

  await barcode.fill("5099969209017");
  await page.getByRole("button", { name: "Place", exact: true }).click();
  await expect(page.getByText("You have 2 Copies of Gas 5. Which one goes here?")).toBeVisible();
  await page.getByRole("button", { name: "Copy 1: Not on a shelf" }).click();
  await expect(counter).toHaveText("2 placed in B2");

  await barcode.fill("602577915062");
  await page.getByRole("button", { name: "Place", exact: true }).click();
  await expect(page.getByText("This record isn't in your Collection yet. Add it to Shelf 1 · B2?")).toBeVisible();
  await page.screenshot({ path: "test-results/fill-unknown.png", fullPage: true });
  await page.getByRole("button", { name: "Add Abbey Road" }).click();
  await expect(counter).toHaveText("3 placed in B2");

  await page.getByRole("searchbox", { name: "Search the Collection" }).fill("Gas");
  await page.getByRole("button", { name: "Place Gas 5" }).click();
  await expect(counter).toHaveText("4 placed in B2");
  await expect(page.getByRole("button", { name: "Here" })).toHaveCount(2);
  await page.screenshot({ path: "test-results/fill-section.png", fullPage: true });

  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("link", { name: "Fill B2, 4 Copies" })).toBeVisible();
});
