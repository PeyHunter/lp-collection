import { expect, test } from "@playwright/test";
import { fakeCamera, logInAsOwner, watchCameras } from "./camera.ts";

test.use({ ...fakeCamera({ tilt: -4, offset: [0.42, 0.05], curve: 0, barcode: "5099969209017" }), permissions: ["camera"] });

test("with the barcode only half in view the camera keeps looking, and leaving the Lookup screen turns it off", async ({ page }) => {
  const cameras = await watchCameras(page);
  await logInAsOwner(page);

  await page.getByRole("link", { name: "Scan" }).click();
  await expect(page.getByText("Hold the barcode inside the frame")).toBeVisible();
  expect(await cameras()).toEqual(["live"]);

  await page.getByRole("link", { name: "Collection" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
  expect(await cameras()).toEqual(["ended"]);
});
