import { fakeCamera } from "./camera.ts";
import { expect, test } from "./login.ts";

test.use({ ...fakeCamera({ tiltDegrees: 0, offset: [0, 0], curve: 0, barcode: "5099969209017" }), permissions: ["camera"] });

test("opening the app shows the Collection value, the Copies and the most valuable ones, and its big Scan button starts the camera", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "overview");
  const { collection } = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  for (const discogsReleaseId of [2474032, 16893476]) {
    expect((await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId } })).status()).toBe(201);
  }
  await page.goto("/");

  const overview = page.getByRole("region", { name: "Overview" });
  await expect(overview).toContainText(/Collection value\s*408 kr/);
  await expect(overview).toContainText("2 Copies");
  const mostValuable = overview.getByRole("region", { name: "Most valuable" });
  await expect(mostValuable.getByRole("link")).toHaveText(["Discovery", "Kind Of Blue"]);

  await mostValuable.getByRole("link", { name: "Kind Of Blue" }).click();
  await expect(page.getByRole("heading", { name: "Kind Of Blue" })).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Scan" }).click();
  await expect(page).toHaveURL(/\/lookup$/);
  await expect(page.getByRole("status")).toHaveText("Read 5099969209017");
});

test("with Values hidden the overview shows only the number of Copies", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "overview-hidden");
  const { collection } = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId: 2474032 } });
  await page.request.put("/api/me/show-values", { data: { showValues: false } });
  await page.goto("/");

  const overview = page.getByRole("region", { name: "Overview" });
  await expect(overview).toContainText("1 Copy");
  await expect(overview).not.toContainText(/kr|Collection value|Most valuable/);
});
