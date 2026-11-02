import { expect, test } from "./login.ts";

test("a new User's Discogs collection is imported at first login, with progress shown while it runs", async ({ page, logInAsNewUser }) => {
  // 120 records with Discogs' rate-limit pauses take a while when other tests share the machine.
  test.setTimeout(90_000);
  await logInAsNewUser(page, "with-discogs-collection");

  await expect(page.getByText("Importing your Discogs collection")).toBeVisible();
  await expect(page.getByRole("region", { name: "Overview" })).toContainText("120 Copies", { timeout: 60_000 });
  await expect(page.getByText("Importing your Discogs collection")).toHaveCount(0);

  const { discogsImport } = (await (await page.request.get("/api/me")).json()) as { discogsImport: unknown };
  expect(discogsImport).toEqual({ status: "done", imported: 120, total: 120 });

  await page.reload();
  await expect(page.getByText("Importing your Discogs collection")).toHaveCount(0);
});
