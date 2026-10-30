import { devices, expect, test, type Page } from "@playwright/test";

const { defaultBrowserType: _browser, ...iPhone } = devices["iPhone 15"];

async function logInOnFakeDiscogs(page: Page, discogsUsername: string) {
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await expect(page.getByRole("heading", { name: "Fake Discogs" })).toBeVisible();
  await page.getByLabel("Discogs username").fill(discogsUsername);
  await page.getByRole("button", { name: "Authorize" }).click();
}

test("the app's Owner invites a friend, who gets their own Collection on their iPhone", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  await expect(page.getByText("LP-Collection is invite only.")).toBeVisible();
  await logInOnFakeDiscogs(page, "owner");
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
  await page.getByRole("button", { name: "Create Invite" }).click();
  const inviteUrl = await page.getByLabel("Invite link").inputValue();
  await expect(page.getByText(/^Works once\. Expires /)).toBeVisible();

  const friendContext = await browser.newContext({ ...iPhone, baseURL });
  const friend = await friendContext.newPage();
  await friend.goto(inviteUrl);
  await expect(friend.getByRole("heading", { name: "You're invited to LP-Collection" })).toBeVisible();
  await logInOnFakeDiscogs(friend, "friend");

  await expect(friend.getByRole("heading", { name: "LP-Collection" })).toBeVisible();
  await expect(friend.getByRole("heading", { name: "Your Collection" })).toBeVisible();
  await expect(friend.getByText("No Copies yet.")).toBeVisible();
  await expect(friend.getByText("Logged in as friend.")).toBeVisible();
  await expect(friend.getByRole("button", { name: "Create Invite" })).toHaveCount(0);

  await friend.reload();
  await expect(friend.getByRole("heading", { name: "Your Collection" })).toBeVisible();

  await friend.getByRole("button", { name: "Log out" }).click();
  await expect(friend.getByText("LP-Collection is invite only.")).toBeVisible();

  await friend.goto(inviteUrl);
  await expect(friend.getByRole("heading", { name: "This Invite has already been used." })).toBeVisible();
  await friendContext.close();
});

test("an invitee whose browser lost the login cookie is told why and can log in again from their Invite", async ({ page, browser, baseURL }) => {
  await page.goto("/");
  await logInOnFakeDiscogs(page, "owner");
  await page.getByRole("button", { name: "Create Invite" }).click();
  const inviteUrl = await page.getByLabel("Invite link").inputValue();

  const friendContext = await browser.newContext({ ...iPhone, baseURL });
  const friend = await friendContext.newPage();
  await friend.goto(inviteUrl);
  await friend.getByRole("link", { name: "Log in with Discogs" }).click();
  await friendContext.clearCookies();
  await friend.getByLabel("Discogs username").fill("cookieless-friend");
  await friend.getByRole("button", { name: "Authorize" }).click();

  await expect(friend.getByRole("heading", { name: "You're invited to LP-Collection" })).toBeVisible();
  await expect(friend.getByRole("alert")).toContainText("Your Discogs login didn't finish because this browser didn't keep its login cookie.");
  await logInOnFakeDiscogs(friend, "cookieless-friend");
  await expect(friend.getByText("Logged in as cookieless-friend.")).toBeVisible();
  await friendContext.close();
});
