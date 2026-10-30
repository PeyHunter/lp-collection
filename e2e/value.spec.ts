import { devices, expect, test, type Page } from "@playwright/test";

const { defaultBrowserType: _browser, ...iPhone } = devices["iPhone 15"];

async function logIn(page: Page, discogsUsername: string) {
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill(discogsUsername);
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
}

async function addByBarcode(page: Page, barcode: string, title: string) {
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill(barcode);
  await page.getByRole("button", { name: "Look up" }).click();
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toHaveText(`Added ${title} to your Collection.`);
}

test("the Owner saves a Copy, sees its Value in kroner, changes the Media condition and sees the new Value", async ({ page }) => {
  await page.goto("/");
  await logIn(page, "owner");
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill("886979891211");
  await page.getByRole("button", { name: "Look up" }).click();
  const pressing = page.getByRole("listitem").filter({ hasText: "Sony Music" });
  await pressing.getByRole("button", { name: "Kind Of Blue" }).click();
  await pressing.getByRole("button", { name: "Add to Collection" }).click();

  const row = page.getByRole("listitem").filter({ hasText: "Sony Music" });
  await expect(row).toContainText("134 kr");

  await row.getByRole("link", { name: "Kind Of Blue" }).click();
  await expect(page.getByRole("heading", { name: "Kind Of Blue" })).toBeVisible();
  const value = page.getByRole("region", { name: "Value" });
  await expect(value).toContainText("134 kr");
  await expect(value).toContainText("Lowest listing 127 kr, any condition");

  await page.getByLabel("Media condition").selectOption("Near Mint (NM or M-)");
  await expect(value).toContainText("179 kr");
  await expect(value).toContainText("for NM or M-");
  await page.getByLabel("Sleeve condition").selectOption("Generic");
  await expect(page.getByLabel("Sleeve condition")).toBeEnabled();

  await page.reload();
  await expect(page.getByRole("region", { name: "Value" })).toContainText("179 kr");
  await expect(page.getByLabel("Media condition")).toHaveValue("Near Mint (NM or M-)");
  await expect(page.getByLabel("Sleeve condition")).toHaveValue("Generic");

  await page.getByRole("link", { name: "Back" }).click();
  await expect(row).toContainText("179 kr");
  await expect(row).toContainText("Media NM or M- · Sleeve Generic");
});

test("a Release with no price suggestion says No Value yet and stays in the list", async ({ page }) => {
  await page.goto("/");
  await logIn(page, "owner");
  await addByBarcode(page, "5099969209017", "Gas 5");

  await expect(page.getByRole("listitem").filter({ hasText: "Gas 5" })).toContainText("No Value yet");
  await page.getByRole("link", { name: "Gas 5" }).click();
  await expect(page.getByRole("region", { name: "Value" })).toContainText("No Value yet");
  await expect(page.getByRole("region", { name: "Value" })).toContainText("Lowest listing 90 kr, any condition");
});

test("a User without Discogs seller settings is guided once to fill them in, then sees Values", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  await logIn(page, "owner");
  await page.getByRole("button", { name: "Create Invite" }).click();
  const inviteUrl = await page.getByLabel("Invite link").inputValue();

  const context = await browser.newContext({ ...iPhone, baseURL });
  const friend = await context.newPage();
  await friend.goto(inviteUrl);
  await friend.getByRole("link", { name: "Log in with Discogs" }).click();
  await friend.getByLabel("Discogs username").fill("no-seller-settings");
  await friend.getByRole("button", { name: "Authorize" }).click();
  await addByBarcode(friend, "190295328709", "Discovery");

  const guide = friend.getByRole("region", { name: "Fill in your Discogs seller settings to see Values" });
  await expect(guide).toBeVisible();
  await expect(friend.getByText("No Value yet")).toHaveCount(0);
  await expect(friend.getByRole("listitem").filter({ hasText: "Discovery" })).toContainText("Waits for seller settings");

  const link = guide.getByRole("link", { name: "Open seller settings on Discogs" });
  await expect(link).toHaveAttribute("href", "/fake-discogs/settings/seller");
  await expect(link).toHaveAttribute("target", "_blank");
  const settings = await context.newPage();
  await settings.goto("/fake-discogs/settings/seller");
  await settings.getByLabel("Discogs username").fill("no-seller-settings");
  await settings.getByRole("button", { name: "Save seller settings" }).click();
  await settings.close();

  await guide.getByRole("button", { name: "I've saved them, fetch Values" }).click();
  await expect(guide).toHaveCount(0);
  await expect(friend.getByRole("listitem").filter({ hasText: "Discovery" })).toContainText("252 kr");
  await context.close();
});
