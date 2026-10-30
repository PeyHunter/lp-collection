import { expect, test } from "@playwright/test";
import { ownerSession } from "./login.ts";

test("the app's Owner logs in with Discogs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("LP-Collection is invite only.")).toBeVisible();
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await expect(page.getByRole("heading", { name: "Fake Discogs" })).toBeVisible();
  await page.getByLabel("Discogs username").fill("owner");
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Invite" })).toBeVisible();
  await page.context().storageState({ path: ownerSession });
});
