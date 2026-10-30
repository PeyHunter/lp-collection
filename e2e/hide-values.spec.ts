import { expect, test } from "./login.ts";

const valueText = /\d\s*kr|Value|Gain|Lowest listing|Purchase|Paid|Currency|seller settings/i;

test("one switch hides every Value on the Collection and the Copy, and brings them back", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "show-off");
  const { collection } = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  const created = await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId: 2474032 } });
  const { copy } = (await created.json()) as { copy: { id: string } };
  await page.request.patch(`/api/collections/${collection.id}/copies/${copy.id}`, { data: { purchasePrice: { amount: 100, currency: "DKK" } } });
  await page.goto("/");
  const copies = page.getByRole("region", { name: "Copies" });
  const valuesSwitch = page.getByRole("switch", { name: "Values" });
  await expect(copies.getByRole("listitem")).toContainText(/\d kr/);
  await expect(valuesSwitch).toBeChecked();

  await valuesSwitch.click();
  await expect(valuesSwitch).not.toBeChecked();
  await expect(copies.getByRole("link")).toHaveText(["Kind Of Blue"]);
  await expect(page.locator("main")).not.toContainText(valueText);
  await expect(page.getByRole("group", { name: "Sort by" }).getByRole("radio")).toHaveCount(4);
  await expect(page.getByLabel("Currency")).toHaveCount(0);

  await page.reload();
  await expect(copies.getByRole("link")).toHaveText(["Kind Of Blue"]);
  await expect(valuesSwitch).not.toBeChecked();
  await expect(page.locator("main")).not.toContainText(valueText);

  await copies.getByRole("link", { name: "Kind Of Blue" }).click();
  await expect(page.getByRole("heading", { name: "Kind Of Blue" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Note" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(valueText);
  await expect(page.getByRole("region", { name: "Value" })).toHaveCount(0);

  await page.getByRole("switch", { name: "Values" }).click();
  await expect(page.getByRole("region", { name: "Value" })).toContainText(/\d kr/);
  await expect(page.getByRole("region", { name: "Value" })).toContainText("Paid 100 kr");
  await expect(page.getByRole("region", { name: "Purchase" })).toBeVisible();

  await page.getByRole("link", { name: "Back" }).click();
  await expect(copies.getByRole("listitem")).toContainText(/\d kr/);
  await expect(page.getByLabel("Currency")).toBeVisible();
});
