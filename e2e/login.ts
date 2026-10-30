import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

/**
 * The Owner's browser session, saved once per run by owner.setup.ts.
 * Logging in from a logged-out browser is limited to 10 per device per 15 minutes and 10 per minute in all,
 * so specs never do it: they reuse this session or come in through an Invite, which has its own limit.
 */
export const ownerSession = join(import.meta.dirname, "../test-results/owner-session.json");

/** Storage for a context that starts logged out in a spec that uses ownerSession. */
export const loggedOut = { cookies: [], origins: [] };

/**
 * Use `test.use({ storageState: ownerSession })` for a page that is the Owner. Every context in that spec starts as
 * the Owner, browser.newContext() included, so give a context that logs someone else in `storageState: loggedOut`:
 * a login in a context holding the Owner session ends that session for every spec.
 */
export const test = base.extend<{ logInAsNewUser: (page: Page, name: string) => Promise<string> }>({
  /** Logs the page in through a new Invite as a new User called <name>-<random>, and returns that Discogs username. */
  logInAsNewUser: async ({ playwright, baseURL }, use) => {
    const owner = await playwright.request.newContext({ baseURL, storageState: ownerSession });
    await use(async (page, name) => {
      const invite = await owner.post("/api/invites");
      expect(invite.ok(), "the Owner session from owner.setup.ts creates an Invite").toBe(true);
      const { url } = (await invite.json()) as { url: string };
      const username = `${name}-${randomUUID().slice(0, 8)}`;
      await page.goto(url);
      await page.getByRole("link", { name: "Log in with Discogs" }).click();
      await page.getByLabel("Discogs username").fill(username);
      await page.getByRole("button", { name: "Authorize" }).click();
      await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
      return username;
    });
    await owner.dispose();
  },
});

export { expect };
