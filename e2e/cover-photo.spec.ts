import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./login.ts";
import { drawShelfPhoto } from "./shelf-photo.ts";

const coverPhoto = async () => ({ name: "cover.jpg", mimeType: "image/jpeg", buffer: await readFile(join(import.meta.dirname, "../test/fixtures/photo.jpg")) });

async function sidewaysOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("a record with no barcode is added in three taps from a photo of its cover", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await page.getByRole("link", { name: "Scan" }).click();

  const main = page.getByRole("main");
  const firstSection = main.locator("section").first();
  await expect(firstSection.getByLabel("Photo of the cover")).toBeAttached();
  await expect(firstSection).toBeInViewport();
  expect(await main.locator("section").evaluateAll((sections) => sections.findIndex((section) => section.querySelector("#scan-heading")))).toBeGreaterThan(0);

  await page.getByLabel("Photo of the cover").setInputFiles(await coverPhoto());

  const best = page.getByRole("group", { name: "Best match" });
  await expect(best.getByRole("heading", { name: "Sgt. Pepper's Lonely Hearts Club Band" })).toBeVisible();
  await expect(best.locator("img")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not this one?" })).toBeVisible();
  // The reading is in the search fields, ready to be corrected.
  await expect(page.getByRole("textbox", { name: "Artist" })).toHaveValue("The Beatles");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Sgt. Pepper's Lonely Hearts Club Band");
  expect(await sidewaysOverflow(page), "the best match fits the screen").toBe(0);

  // Seen without scrolling, so adding is photo, shutter, Add.
  await expect(best.getByRole("button", { name: "Add to my collection" })).toBeInViewport();
  await best.getByRole("button", { name: "Add to my collection" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Sgt. Pepper's Lonely Hearts Club Band to your Collection.");
});

test("filling a Section, a photo of a cover adds the record there", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "filler");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shelves" }).click();
  await page.getByRole("link", { name: "Set up a Shelf" }).click();
  await page.getByLabel("Take or pick a photo").setInputFiles({ name: "shelf.jpg", mimeType: "image/jpeg", buffer: await drawShelfPhoto(page) });
  await page.getByLabel("Shelf name").fill("Shelf 1");
  await page.getByRole("button", { name: "Save Shelf" }).click();
  await page.getByRole("link", { name: "Shelf 1" }).click();
  await page.getByRole("link", { name: "Fill B2, 0 Copies" }).click();

  await page.getByLabel("Photo of the cover").setInputFiles(await coverPhoto());
  const best = page.getByRole("group", { name: "Best match" });
  await best.getByRole("button", { name: "Add to my collection" }).click();
  await expect(page.getByText("Put Sgt. Pepper's Lonely Hearts Club Band in Shelf 1 · B2. Scan the next one.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "placed in B2" })).toHaveText("1 placed in B2");
});

test("adding another pressing of an album the Collection holds asks first, then adds it", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByLabel("Photo of the cover").setInputFiles(await coverPhoto());
  await page.getByRole("group", { name: "Best match" }).getByRole("button", { name: "Add to my collection" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Sgt. Pepper's Lonely Hearts Club Band to your Collection.");

  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByLabel("Photo of the cover").setInputFiles(await coverPhoto());
  const germany = page.getByRole("listitem").filter({ hasText: "Germany" });
  await germany.getByRole("button", { name: "Sgt. Pepper's Lonely Hearts Club Band" }).click();
  await germany.getByRole("button", { name: "Add to Collection" }).click();
  await expect(germany.getByRole("alert")).toHaveText("You already have Sgt. Pepper's Lonely Hearts Club Band. Add it again only if this is another Copy.");
  await page.screenshot({ path: "test-results/lookup-another-pressing.png", fullPage: true });
  await germany.getByRole("button", { name: "Add another" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Sgt. Pepper's Lonely Hearts Club Band to your Collection.");
  await expect(page.getByRole("region", { name: "Copies" }).getByRole("listitem").filter({ hasText: "Sgt. Pepper's" })).toHaveCount(2);
});

test("filling a Section, another pressing of a held album asks: place the one I have, or add another Copy", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "filler");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shelves" }).click();
  await page.getByRole("link", { name: "Set up a Shelf" }).click();
  await page.getByLabel("Take or pick a photo").setInputFiles({ name: "shelf.jpg", mimeType: "image/jpeg", buffer: await drawShelfPhoto(page) });
  await page.getByLabel("Shelf name").fill("Shelf 1");
  await page.getByRole("button", { name: "Save Shelf" }).click();
  await page.getByRole("link", { name: "Shelf 1" }).click();
  await page.getByRole("link", { name: "Fill B2, 0 Copies" }).click();
  const counter = page.getByRole("status").filter({ hasText: "placed in B2" });

  await page.getByLabel("Photo of the cover").setInputFiles(await coverPhoto());
  await page.getByRole("group", { name: "Best match" }).getByRole("button", { name: "Add to my collection" }).click();
  await expect(counter).toHaveText("1 placed in B2");

  await page.getByLabel("Photo of the cover").setInputFiles(await coverPhoto());
  await page.getByRole("button", { name: /^Sgt\. Pepper's Lonely Hearts Club Band \(Germany/ }).click();
  await expect(page.getByText("You already have Sgt. Pepper's Lonely Hearts Club Band. Add it again only if this is another Copy.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Put the one I have here (Shelf 1 · B2)" })).toBeVisible();
  await page.screenshot({ path: "test-results/fill-another-pressing.png", fullPage: true });
  await page.getByRole("button", { name: "Add another Copy" }).click();
  await expect(page.getByText("Put Sgt. Pepper's Lonely Hearts Club Band in Shelf 1 · B2. Scan the next one.")).toBeVisible();
  await expect(counter).toHaveText("2 placed in B2");
});
