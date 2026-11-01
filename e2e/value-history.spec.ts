import { expect, test } from "./login.ts";
import { runRefresh } from "./refresh.ts";

test("after the monthly refresh a Copy shows its Value history", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "history");
  const { collection } = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  const created = await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId: 2474032 } });
  const { copy } = (await created.json()) as { copy: { id: string; value: { value: number } } };
  await page.goto(`/copies/${copy.id}`);
  await expect(page.getByRole("region", { name: "Value", exact: true })).toContainText(/\d kr/);
  await expect(page.getByRole("region", { name: "Value history" })).toHaveCount(0);

  expect(runRefresh()).toMatch(/Refresh \d{4}-\d{2}: \d+ Values fetched/);
  await page.reload();

  const history = page.getByRole("region", { name: "Value history" });
  const month = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date());
  await expect(history.getByRole("listitem")).toHaveText([new RegExp(`${month}\\s*${Math.round(copy.value.value)} kr`)]);

  await page.getByRole("switch", { name: "Values" }).click();
  await expect(page.getByRole("region", { name: "Value history" })).toHaveCount(0);
});
