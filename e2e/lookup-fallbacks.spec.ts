import type { Page } from "@playwright/test";
import { expect, test } from "./login.ts";

test("a record with no barcode is found by falling back to the artist and title", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await page.getByRole("link", { name: "Scan" }).click();

  await page.getByRole("textbox", { name: "Barcode" }).fill("4006381333931");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("No Release on Discogs has the barcode 4006381333931.")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Catalog number" })).toHaveCount(0);
  await page.getByRole("button", { name: "Search by artist and title" }).click();

  await expect(page.getByRole("textbox", { name: "Artist" })).toBeFocused();
  await page.getByRole("textbox", { name: "Artist" }).fill("Beatles");
  await page.getByRole("textbox", { name: "Title" }).fill("Sgt Pepper");
  await page.getByRole("button", { name: "Look up" }).click();

  await expect(page.getByRole("heading", { name: "Which one is yours?" })).toBeVisible();
  await expect(page.getByText("2 Releases match.")).toBeVisible();
  const uk = page.getByRole("listitem").filter({ hasText: "Parlophone" });
  await uk.getByRole("button", { name: "Sgt. Pepper's Lonely Hearts Club Band" }).click();
  await uk.getByRole("button", { name: "Add to Collection" }).click();

  await expect(page.getByRole("status")).toHaveText("Added Sgt. Pepper's Lonely Hearts Club Band to your Collection.");
});

test("a misspelled artist finds nothing, and tapping the suggested spelling finds the Release", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await page.getByRole("link", { name: "Scan" }).click();

  await page.getByRole("radio", { name: "Artist and title" }).check();
  await page.getByRole("textbox", { name: "Artist" }).fill("Pink Floid");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("Nothing on Discogs matches Pink Floid. Did you mean:")).toBeVisible();
  expect(await sidewaysOverflow(page), "the suggestions fit the screen").toBe(0);

  await page.getByRole("button", { name: "Pink Floyd · The Dark Side Of The Moon" }).click();
  await expect(page.getByRole("textbox", { name: "Artist" })).toHaveValue("Pink Floyd");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("The Dark Side Of The Moon");
  await expect(page.getByRole("heading", { name: "Which one is yours?" })).toBeVisible();
  await expect(page.getByText("3 Releases match.")).toBeVisible();
});

test("a misspelling with nothing close keeps the spelling tip", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await page.getByRole("link", { name: "Scan" }).click();

  await page.getByRole("radio", { name: "Artist and title" }).check();
  await page.getByRole("textbox", { name: "Artist" }).fill("Nobody Anyone Knows");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("Nothing on Discogs matches Nobody Anyone Knows.", { exact: true })).toBeVisible();
  await expect(page.getByText("Check the spelling, or type less: only the artist, or a few words of the title.")).toBeVisible();
});

async function sidewaysOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("a long typed search wraps instead of pushing the page sideways", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await page.getByRole("link", { name: "Scan" }).click();

  const unbroken = "X".repeat(100);
  await page.getByRole("radio", { name: "Artist and title" }).check();
  await page.getByRole("textbox", { name: "Artist" }).fill(unbroken);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText(`Nothing on Discogs matches ${unbroken}.`)).toBeVisible();
  expect(await sidewaysOverflow(page), "an artist miss fits the screen").toBe(0);

  await page.getByRole("textbox", { name: "Artist" }).fill("The Beatles");
  await page.getByRole("textbox", { name: "Title" }).fill("Sgt. Pepper's Lonely Hearts Club Band");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("heading", { name: "Which one is yours?" })).toBeVisible();
  expect(await sidewaysOverflow(page), "the searched artist and title above the matches fit the screen").toBe(0);
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await sidewaysOverflow(page), "the searched artist and title fit the narrowest iPhone").toBe(0);
});

test("picking a Release the Collection already has warns with the Copy count, and Cancel or Add another decide", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill("5099969209017");
  await page.getByRole("button", { name: "Look up" }).click();
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Gas 5 to your Collection.");

  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("radio", { name: "Artist and title" }).check();
  await page.getByRole("textbox", { name: "Artist" }).fill("gasolin");
  await page.getByRole("textbox", { name: "Title" }).fill("gas 5");
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
