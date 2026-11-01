import type { Page } from "@playwright/test";
import { expect, test } from "./login.ts";
import { drawShelfPhoto } from "./shelf-photo.ts";

async function addDiscovery(page: Page) {
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill("190295328709");
  await page.getByRole("button", { name: "Look up" }).click();
}

test("a User puts a Copy in a Section, sees where it lives, and finds it again from Lookup", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "placer");
  await addDiscovery(page);
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Discovery to your Collection.");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shelves" }).click();
  await page.getByRole("link", { name: "Set up a Shelf" }).click();
  await page.getByLabel("Take or pick a photo").setInputFiles({ name: "shelf.jpg", mimeType: "image/jpeg", buffer: await drawShelfPhoto(page) });
  await page.getByLabel("Shelf name").fill("Shelf 1");
  await page.getByRole("button", { name: "Save Shelf" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Shelf 1" })).toContainText("24 Sections");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Collection" }).click();
  await page.getByRole("checkbox", { name: "Not on a shelf" }).check();
  const row = page.getByRole("listitem").filter({ hasText: "Discovery" });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "Discovery" }).click();

  const place = page.getByRole("region", { name: "Shelf" });
  await expect(place).toContainText("Not on a shelf");
  await place.getByLabel("Put in").selectOption({ label: "Shelf 1 · C4" });
  await expect(place.getByRole("img", { name: "Shelf 1 with C4 picked out" })).toBeVisible();
  await expect(place.locator(".cell.on")).toHaveCount(1);
  await page.screenshot({ path: "test-results/place-copy.png", fullPage: true });

  // Back returns to the list as it was left, still showing only Copies Not on a shelf, which Discovery no longer is.
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByText("No Copies match that are Not on a shelf.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Not on a shelf" }).uncheck();
  await expect(page.getByRole("listitem").filter({ hasText: "Discovery" })).toContainText("Shelf 1 · C4");

  await addDiscovery(page);
  await page.getByRole("button", { name: /Discovery/ }).click();
  await expect(page.getByText("Yours is: Shelf 1 · C4.")).toBeVisible();
  await page.screenshot({ path: "test-results/place-lookup.png", fullPage: true });
});
