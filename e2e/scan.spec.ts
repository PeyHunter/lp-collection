import { fakeCamera, watchCameras } from "./camera.ts";
import { expect, test } from "./login.ts";

test.use({ ...fakeCamera({ tiltDegrees: 6, offset: [0, 0], curve: 0.6, glare: { at: [0.55, 0.45], radiusPx: 70, strength: 0.5 }, barcode: "5099969209017" }), permissions: ["camera"] });

test("a User scans a sleeve's barcode and adds the matching Release without typing", async ({ page, logInAsNewUser }) => {
  const cameras = await watchCameras(page);
  await logInAsNewUser(page, "scanner");

  await page.getByRole("link", { name: "Scan" }).click();
  await expect(page.getByRole("status")).toHaveText("Read 5099969209017");
  await expect(page.getByRole("textbox", { name: "Barcode" })).toHaveValue("5099969209017");
  await expect(page.getByRole("heading", { name: "1 Release matches" })).toBeVisible();
  expect(await cameras(), "the camera is off once it has read the barcode").toEqual(["ended"]);

  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Gas 5 to your Collection.");
  await expect(page.getByRole("listitem").filter({ hasText: "Gas 5" })).toContainText("Gasolin'");
});

test.describe("when the camera is blocked", () => {
  test.use({ permissions: [] });

  test("the User is told so and types the barcode instead", async ({ page, logInAsNewUser }) => {
    await logInAsNewUser(page, "scanner");
    await page.getByRole("link", { name: "Scan" }).click();

    await expect(page.getByRole("status")).toContainText("LP-Collection isn't allowed to use the camera. Type the barcode below instead.");
    await page.getByRole("textbox", { name: "Barcode" }).fill("5099969209017");
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByRole("heading", { name: "1 Release matches" })).toBeVisible();
  });
});

test("when the phone can't read the camera's picture, the User is told scanning failed and types the barcode instead", async ({ page, logInAsNewUser }) => {
  await page.addInitScript(() => {
    CanvasRenderingContext2D.prototype.getImageData = () => {
      throw new DOMException("out of memory", "InvalidStateError");
    };
  });
  await logInAsNewUser(page, "scanner");
  await page.getByRole("link", { name: "Scan" }).click();

  await expect(page.getByRole("status")).toContainText("Scanning failed on this phone. Type the barcode below instead, or try again.");
  await page.getByRole("textbox", { name: "Barcode" }).fill("5099969209017");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("heading", { name: "1 Release matches" })).toBeVisible();
});
