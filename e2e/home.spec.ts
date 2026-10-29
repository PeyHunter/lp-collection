import { expect, test } from "@playwright/test";

test("the app opens on an iPhone and shows its name", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "LP-Collection" })).toBeVisible();
});
