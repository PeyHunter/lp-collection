import { expect, test } from "./login.ts";

test("a User finds a Copy with the search box, sorts by Period and Value, and narrows the list by genre and Period", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "searcher");
  const { collection } = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  for (const discogsReleaseId of [13716287, 3133906, 1046716]) {
    expect((await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId } })).status()).toBe(201);
  }
  await page.goto("/");
  const copies = page.getByRole("region", { name: "Copies" });
  const search = page.getByRole("searchbox", { name: "Search the Collection" });

  await search.fill("kraftwerk");
  await expect(copies.getByRole("link")).toHaveText(["Trans-Europe Express"]);
  await expect(copies.getByRole("listitem")).toContainText("1977 · pressed 1977 · Kling Klang · 1C 064-82 306");
  await search.fill("PCS7088");
  await expect(copies.getByRole("link")).toHaveText(["Abbey Road"]);
  await expect(copies.getByRole("listitem")).toContainText("1969 · pressed 2019");

  await search.fill("");
  await page.getByRole("group", { name: "Sort by" }).getByText("Period", { exact: true }).click();
  await expect(copies.getByRole("heading", { name: /^the 60s 1 LP$/i })).toBeVisible();

  await page.getByRole("group", { name: "Genre" }).getByText("Electronic").click();
  await page.getByRole("group", { name: "Period" }).getByText("70s").click();
  await expect(copies.getByRole("link")).toHaveText(["Trans-Europe Express"]);

  await page.getByRole("group", { name: "Sort by" }).getByText("Value", { exact: true }).click();
  await page.getByRole("button", { name: /Reverse the order/ }).click();
  await expect(page.getByText("Low first. Copies with no Value always come last.")).toBeVisible();
  await page.reload();
  await expect(copies.getByRole("link")).toHaveText(["Trans-Europe Express"]);
});
