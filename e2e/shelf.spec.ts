import type { Locator, Page } from "@playwright/test";
import { perspective } from "../src/web/shelf-grid.ts";
import { expect, test } from "./login.ts";
import { drawnCorners, drawShelfPhoto } from "./shelf-photo.ts";

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  expect(found).not.toBeNull();
  return found!;
}

async function expectC4OnTheDrawnCube(page: Page) {
  const frame = await box(page.getByRole("img", { name: "Shelf photo with its squares drawn over it" }));
  const label = await box(page.locator("svg text", { hasText: /^C4$/ }));
  const cube = perspective(drawnCorners)({ x: 2.5 / 4, y: 3.5 / 6 });
  expect(Math.abs(label.x + label.width / 2 - (frame.x + cube.x * frame.width)), "C4 sits on the third column").toBeLessThan(frame.width / 40);
  expect(Math.abs(label.y + label.height / 2 - (frame.y + cube.y * frame.height)), "C4 sits on the fourth row").toBeLessThan(frame.height / 60);
}

test("a User sets up a Shelf from a photo, lines up its corners, shrinks it and deletes it", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "shelver");
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill("190295328709");
  await page.getByRole("button", { name: "Look up" }).click();
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Discovery to your Collection.");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shelves" }).click();
  await expect(page.getByText("No Shelves yet.")).toBeVisible();
  await expect(page.getByText("1 Copy is Not on a shelf.")).toBeVisible();
  await page.getByRole("link", { name: "Set up a Shelf" }).click();
  await expect(page.getByRole("heading", { name: "New Shelf" })).toBeVisible();

  await page.getByLabel("Take or pick a photo").setInputFiles({ name: "shelf.jpg", mimeType: "image/jpeg", buffer: await drawShelfPhoto(page) });
  const photo = page.getByRole("img", { name: "Shelf photo with its squares drawn over it" });
  await expect(photo.locator(".cell")).toHaveCount(24);
  const frame = await box(photo);
  for (const [index, name] of ["Top left", "Top right", "Bottom right", "Bottom left"].entries()) {
    const dot = await box(page.getByRole("button", { name: `${name} corner. Drag it, or use the arrow keys.` }));
    expect(Math.min(dot.width, dot.height), `${name} dot is easy to tap`).toBeGreaterThanOrEqual(44);
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await page.mouse.down();
    await page.mouse.move(frame.x + drawnCorners[index]!.x * frame.width, frame.y + drawnCorners[index]!.y * frame.height, { steps: 5 });
    await page.mouse.up();
  }
  await expectC4OnTheDrawnCube(page);
  await page.getByLabel("Shelf name").fill("Living room");
  await page.getByRole("button", { name: "Save Shelf" }).click();

  const shelf = page.getByRole("listitem").filter({ hasText: "Living room" });
  await expect(shelf).toContainText("4 × 6 · 24 Sections");
  await shelf.getByRole("link", { name: "Living room" }).click();
  await expect(page.getByRole("heading", { name: "Living room" })).toBeVisible();
  await expectC4OnTheDrawnCube(page);
  await page.setViewportSize({ width: 700, height: 900 });
  await expectC4OnTheDrawnCube(page);
  await page.getByRole("button", { name: "One row fewer" }).click();
  await expect(photo.locator(".cell")).toHaveCount(20);
  await page.getByRole("button", { name: "Save Shelf" }).click();
  await expect(shelf).toContainText("4 × 5 · 20 Sections");

  await shelf.getByRole("link", { name: "Living room" }).click();
  await page.getByRole("button", { name: "Delete this Shelf" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No Shelves yet.")).toBeVisible();
});
