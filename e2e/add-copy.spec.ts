import { expect, test, type Locator, type Page } from "@playwright/test";

async function logInAsOwner(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill("owner");
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
}

async function pixelAt(page: Page, x: number, y: number) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  return page.evaluate(async (base64) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(",");
  }, png.toString("base64"));
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
}

test("the Owner types a barcode, picks one of several pressings and finds the new Copy in the Collection", async ({ page }) => {
  await logInAsOwner(page);

  await page.getByRole("link", { name: "Scan" }).click();
  await expect(page.getByRole("heading", { name: "Add a record" })).toBeVisible();
  await page.getByRole("textbox", { name: "Barcode" }).fill("8 86979 89121 1");
  await page.getByRole("button", { name: "Look up" }).click();

  await expect(page.getByRole("heading", { name: "3 Releases match" })).toBeVisible();
  const pressings = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Kind Of Blue" }) });
  await expect(pressings).toHaveCount(3);
  const european2010 = pressings.filter({ hasText: "2010 · Europe · Columbia" });
  await european2010.getByRole("button", { name: "Kind Of Blue" }).click();
  await expect(european2010).toContainText("Will be saved with Media condition and Sleeve condition Very Good Plus.");
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

test("the tint on a just-saved Copy leaves room around the cover and the Value", async ({ page }) => {
  await logInAsOwner(page);
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill("190295328709");
  await page.getByRole("button", { name: "Look up" }).click();
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Discovery to your Collection.");

  const row = page.getByRole("listitem").filter({ hasText: "Discovery" });
  const cover = await box(row.locator("img, svg").first());
  const value = await box(row.getByText("No Value yet"));
  const middle = cover.y + cover.height / 2;
  const background = await pixelAt(page, 1, middle);

  expect(await pixelAt(page, cover.x + 0.5, middle - cover.height / 2 - 1)).not.toBe(background);
  expect(await pixelAt(page, cover.x - 6, middle)).not.toBe(background);
  expect(await pixelAt(page, value.x + value.width + 6, middle)).not.toBe(background);
});

test("at 150% text size the bottom bar labels fit inside the screen", async ({ page }) => {
  await logInAsOwner(page);
  await page.addStyleTag({ content: "html { font-size: 150%; }" });

  const viewport = page.viewportSize()!;
  for (const name of ["Scan", "Collection"]) {
    const tab = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name });
    const { x, width } = await box(tab);
    expect(x, `${name} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(x + width, `${name} ends on screen`).toBeLessThanOrEqual(viewport.width);
    expect(await tab.evaluate((element) => element.scrollWidth <= element.clientWidth), `${name} label is not cut off`).toBe(true);
  }
});
