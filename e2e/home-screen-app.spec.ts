import { expect, test } from "@playwright/test";

test("the app is installable: its manifest opens it standalone with home-screen icons, and iOS gets its own tags", async ({ page, request }) => {
  await page.goto("/");

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  const answer = await request.get(manifestHref!);
  expect(answer.ok()).toBe(true);
  const manifest = (await answer.json()) as { name: string; start_url: string; display: string; icons: { src: string; sizes: string; purpose?: string }[] };
  expect(manifest).toMatchObject({ name: "LP-Collection", start_url: "/", display: "standalone" });
  expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose ?? "any"}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect([icon.src, image.status(), image.headers()["content-type"]]).toEqual([icon.src, 200, "image/png"]);
  }

  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect((await request.get(touchIcon!)).status()).toBe(200);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "LPs");
});

test("the service worker takes over, and the app still opens without a connection", async ({ page, context }) => {
  await page.goto("/");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "LP-Collection" })).toBeVisible();
  await expect(page.getByText("LP-Collection can't reach its server right now.")).toBeVisible();
  await context.setOffline(false);
});
