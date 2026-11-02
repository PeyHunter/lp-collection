import { expect, ownerSession, test } from "./login.ts";

test("a Member switches to the Owner's Collection with one tap, adds a Copy there, and loses it when removed", async ({ page, playwright, baseURL, logInAsNewUser }) => {
  const username = await logInAsNewUser(page, "member");
  const owner = await playwright.request.newContext({ baseURL, storageState: ownerSession });
  const { collection } = (await (await owner.get("/api/me")).json()) as { collection: { id: string } };
  const added = await owner.post(`/api/collections/${collection.id}/members`, { data: { discogsUsername: username } });
  expect(added.status()).toBe(201);
  const { member } = (await added.json()) as { member: { userId: string } };

  await page.reload();
  const switcher = page.getByRole("group", { name: "Collection" });
  await expect(switcher.getByRole("radio")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: /Your Collection/ })).toBeVisible();

  await switcher.getByText("owner's").click();
  await expect(page.getByRole("heading", { name: /owner's Collection/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Members" })).toContainText(username);
  await expect(page.getByRole("button", { name: `Remove ${username}` })).toHaveCount(0);

  expect((await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId: 2474032 } })).status()).toBe(201);
  await page.reload();
  await expect(page.getByRole("heading", { name: /owner's Collection/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Copies" }).getByRole("link", { name: "Kind Of Blue" }).first()).toBeVisible();

  expect((await owner.delete(`/api/collections/${collection.id}/members/${member.userId}`)).status()).toBe(204);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Your Collection/ })).toBeVisible();
  await expect(page.getByRole("group", { name: "Collection" })).toHaveCount(0);
  await owner.dispose();
});
