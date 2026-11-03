import { fakeCamera } from "./camera.ts";
import { expect, test } from "./login.ts";

test.use({ ...fakeCamera({ tiltDegrees: 4, offset: [0, 0], curve: 0.4, barcode: "5099902894119" }), permissions: ["camera"] });

test("the User taps the details that differ until only their pressing is left, and adds it", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "scanner");
  await page.getByRole("link", { name: "Scan" }).click();

  const matches = page.getByRole("region", { name: "Matches" });
  await expect(page.getByRole("heading", { name: "Which one is yours?" })).toBeInViewport();
  await expect(matches.getByText("3 Releases match.")).toBeVisible();
  const pressings = matches.getByRole("listitem").filter({ has: page.getByRole("button", { name: "The Dark Side Of The Moon" }) });
  await expect(pressings).toHaveCount(3);

  const europe = matches.getByRole("group", { name: "Country" }).getByRole("button", { name: "Europe 2" });
  await europe.click();
  await expect(europe).toHaveAttribute("aria-pressed", "true");
  await expect(pressings).toHaveCount(2);
  await expect(pressings.filter({ hasText: "UK" })).toHaveCount(0);
  await expect(matches.getByRole("button", { name: "Show all 3" })).toBeVisible();

  await matches.getByRole("group", { name: "Year" }).getByRole("button", { name: "2016 1" }).click();
  await expect(pressings).toHaveCount(1);
  await expect(pressings).toContainText("Pink Floyd Records");
  await pressings.getByRole("button", { name: "Add to Collection" }).click();

  await expect(page.getByRole("status")).toHaveText("Added The Dark Side Of The Moon to your Collection.");
  await expect(page.getByRole("region", { name: "Copies" }).getByRole("listitem").filter({ hasText: "The Dark Side Of The Moon" })).toContainText("PFRLP8");
});
