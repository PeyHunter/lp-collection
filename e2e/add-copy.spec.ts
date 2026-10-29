import { expect, test } from "@playwright/test";

test("the Owner types a barcode, picks one of several pressings and finds the new Copy in the Collection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill("owner");
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();

  await page.getByRole("link", { name: "Scan" }).click();
  await expect(page.getByRole("heading", { name: "Add a record" })).toBeVisible();
  await page.getByRole("textbox", { name: "Barcode" }).fill("8 86979 89121 1");
  await page.getByRole("button", { name: "Look up" }).click();

  await expect(page.getByRole("heading", { name: "3 Releases match" })).toBeVisible();
  const pressings = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Kind Of Blue" }) });
  await expect(pressings).toHaveCount(3);
  const european2010 = pressings.filter({ hasText: "2010 · Europe · Columbia" });
  await european2010.getByRole("button", { name: "Kind Of Blue" }).click();
  await european2010.getByRole("button", { name: "Add to Collection" }).click();

  await expect(page.getByRole("status")).toHaveText("Added Kind Of Blue to your Collection.");
  const copy = page.getByRole("listitem").filter({ hasText: "Kind Of Blue" });
  await expect(copy).toContainText("Miles Davis");
  await expect(copy).toContainText("1959 · Columbia · 88697 98912 1");
  await expect(copy).toContainText("Media VG+ · Sleeve VG+");

  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Kind Of Blue" })).toContainText("Media VG+ · Sleeve VG+");
  await expect(page.getByRole("status")).toHaveCount(0);
});
