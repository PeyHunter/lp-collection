import type { Page } from "@playwright/test";
import { expect, test } from "./login.ts";

test("a record with no barcode is found by falling back to the Catalog number, then the artist and title", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
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

async function sidewaysOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("a long typed search wraps instead of pushing the page sideways", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await page.getByRole("link", { name: "Scan" }).click();

  const unbroken = "X".repeat(100);
  await page.getByRole("radio", { name: "Catalog number" }).check();
  await page.getByRole("textbox", { name: "Catalog number" }).fill(unbroken);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText(`No Release on Discogs has the Catalog number ${unbroken}.`)).toBeVisible();
  expect(await sidewaysOverflow(page), "a Catalog number miss fits the screen").toBe(0);

  await page.getByRole("radio", { name: "Artist and title" }).check();
  await page.getByRole("textbox", { name: "Artist" }).fill("The Beatles");
  await page.getByRole("textbox", { name: "Title" }).fill("Sgt. Pepper's Lonely Hearts Club Band");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("heading", { name: "2 Releases match" })).toBeVisible();
  expect(await sidewaysOverflow(page), "the searched artist and title above the matches fit the screen").toBe(0);
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await sidewaysOverflow(page), "the searched artist and title fit the narrowest iPhone").toBe(0);
});

test("picking a Release the Collection already has warns with the Copy count, and Cancel or Add another decide", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
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
