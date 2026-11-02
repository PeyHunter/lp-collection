import { expect, test } from "./login.ts";

test("a Copy Discogs won't take yet is still saved, and says it isn't synced to Discogs yet", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "no-collection-sync");
  const { collection } = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  expect((await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId: 2474032 } })).status()).toBe(201);
  await page.goto("/");

  const row = page.getByRole("region", { name: "Copies" }).getByRole("listitem").filter({ hasText: "Kind Of Blue" });
  await expect(row).toContainText("Not synced to Discogs yet");

  await row.getByRole("link", { name: "Kind Of Blue" }).click();
  await expect(page.getByText("Not synced to Discogs yet. The app keeps trying; the change is saved here either way.")).toBeVisible();
});

test("a Copy Discogs took shows no marker", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "synced");
  const { collection } = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId: 2474032 } });
  await expect
    .poll(async () => ((await (await page.request.get(`/api/collections/${collection.id}/copies`)).json()) as { notSyncedYet: string[] }).notSyncedYet)
    .toEqual([]);
  await page.goto("/");

  await expect(page.getByRole("region", { name: "Copies" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.locator("main")).not.toContainText("Not synced");
});
