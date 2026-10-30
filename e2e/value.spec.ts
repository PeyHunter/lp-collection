import type { Page } from "@playwright/test";
import { expect, test } from "./login.ts";

async function addByBarcode(page: Page, barcode: string, title: string, pressing?: string) {
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill(barcode);
  await page.getByRole("button", { name: "Look up" }).click();
  const choice = pressing ? page.getByRole("listitem").filter({ hasText: pressing }) : page;
  if (pressing) await choice.getByRole("button", { name: title }).click();
  await choice.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toHaveText(`Added ${title} to your Collection.`);
}

test("a User saves a Copy, sees its Value in kroner, changes the Media condition and sees the new Value", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await addByBarcode(page, "886979891211", "Kind Of Blue", "Sony Music");

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

test("a Release with no price suggestion says No Value yet and stays in the list", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await addByBarcode(page, "5099969209017", "Gas 5");

  await expect(page.getByRole("listitem").filter({ hasText: "Gas 5" })).toContainText("No Value yet");
  await page.getByRole("link", { name: "Gas 5" }).click();
  await expect(page.getByRole("region", { name: "Value" })).toContainText("No Value yet");
  await expect(page.getByRole("region", { name: "Value" })).toContainText("Lowest listing 90 kr, any condition");
});

test("a User without Discogs seller settings is guided once to fill them in, then sees Values", async ({ page, context, logInAsNewUser }) => {
  const username = await logInAsNewUser(page, "no-seller-settings");
  await addByBarcode(page, "190295328709", "Discovery");

  const guide = page.getByRole("region", { name: "Fill in your Discogs seller settings to see Values" });
  await expect(guide).toBeVisible();
  await expect(page.getByText("No Value yet")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Discovery" })).toContainText("Waits for seller settings");

  const link = guide.getByRole("link", { name: "Open seller settings on Discogs" });
  await expect(link).toHaveAttribute("href", "/fake-discogs/settings/seller");
  await expect(link).toHaveAttribute("target", "_blank");
  const settings = await context.newPage();
  await settings.goto("/fake-discogs/settings/seller");
  await settings.getByLabel("Discogs username").fill(username);
  await settings.getByRole("button", { name: "Save seller settings" }).click();
  await settings.close();

  await guide.getByRole("button", { name: "I've saved them, fetch Values" }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "Discovery" })).toContainText("252 kr");
});

test("changing the currency shows every Copy's Value in the new currency", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "collector");
  await addByBarcode(page, "190295328709", "Discovery");
  await addByBarcode(page, "886979891211", "Kind Of Blue", "Sony Music");
  const discovery = page.getByRole("listitem").filter({ hasText: "Discovery" });
  const kindOfBlue = page.getByRole("listitem").filter({ hasText: "Sony Music" });
  await expect(discovery).toContainText("252 kr");
  await expect(kindOfBlue).toContainText("134 kr");

  await page.getByLabel("Currency").selectOption("EUR");

  await expect(discovery).toContainText("34 €");
  await expect(kindOfBlue).toContainText("18 €");
  await page.reload();
  await expect(discovery).toContainText("34 €");
  await expect(page.getByRole("list").filter({ hasText: "Discovery" })).not.toContainText("kr");
});

async function bigPhoto(page: Page) {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(3000, 2000);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#6b4a2f";
    context.fillRect(0, 0, 3000, 2000);
    context.fillStyle = "#111";
    context.beginPath();
    context.arc(1500, 1000, 900, 0, 2 * Math.PI);
    context.fill();
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
  });
  return { name: "IMG_0001.PNG", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

test("a User adds a photo of a Copy, sees it instead of the cover, deletes it, then deletes the Copy", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "photographer");
  await addByBarcode(page, "190295328709", "Discovery");
  const row = page.getByRole("listitem").filter({ hasText: "Discovery" });
  await expect(row.locator("img")).toHaveAttribute("src", "/fake-discogs/covers/16893476.svg");

  await row.getByRole("link", { name: "Discovery" }).click();
  const photos = page.getByRole("region", { name: "Photos" });
  await expect(photos).toContainText("No photos yet.");

  const uploaded = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/photos"));
  await photos.getByLabel("Take or pick a photo").setInputFiles(await bigPhoto(page));
  const { copy } = (await (await uploaded).json()) as { copy: { photos: { url: string; width: number; height: number }[] } };
  expect(copy.photos).toMatchObject([{ width: 2048, height: 1365 }]);

  const photo = photos.getByRole("img", { name: "Photo 1 of Discovery" });
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(2048);
  await expect(page.locator(".big-cover")).toHaveAttribute("src", copy.photos[0]!.url);

  await page.reload();
  await expect(photos.getByRole("img", { name: "Photo 1 of Discovery" })).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(row.locator("img")).toHaveAttribute("src", copy.photos[0]!.url);

  await row.getByRole("link", { name: "Discovery" }).click();
  await photos.getByRole("button", { name: "Delete photo 1" }).click();
  await photos.getByRole("group", { name: "Delete this photo?" }).getByRole("button", { name: "Delete" }).click();
  await expect(photos).toContainText("No photos yet.");
  await expect(page.locator(".big-cover")).toHaveAttribute("src", "/fake-discogs/covers/16893476.svg");

  await photos.getByLabel("Take or pick a photo").setInputFiles(await bigPhoto(page));
  await expect(photos.getByRole("img", { name: "Photo 1 of Discovery" })).toBeVisible();
  await page.getByRole("button", { name: "Delete this Copy" }).click();
  const confirm = page.getByRole("group", { name: "Delete Discovery and its photo? This can't be undone." });
  await confirm.getByRole("button", { name: "Keep it" }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole("button", { name: "Delete this Copy" }).click();
  await confirm.getByRole("button", { name: "Delete Copy" }).click();

  await expect(page.getByRole("status")).toHaveText("Deleted Discovery from your Collection.");
  await expect(page.getByText("No Copies yet.")).toBeVisible();
});
