import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./login.ts";

/** Waits until the crate has stopped on a cover, so a swipe never starts while the last one is still snapping. */
function settled(crate: Locator) {
  return crate.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let last = -1;
        const timer = setInterval(() => {
          if (element.scrollLeft === last && element.scrollLeft % element.clientWidth === 0) {
            clearInterval(timer);
            resolve();
          }
          last = element.scrollLeft;
        }, 100);
      }),
  );
}

/**
 * A swipe across the crate through Chromium's own gesture input, so scroll snapping decides where it lands. Headless
 * Chromium ignores touch-sourced gestures, so this uses the default source, which scrolls the same way.
 */
async function swipe(page: Page, direction: "left" | "right") {
  const crate = page.getByRole("list", { name: "Covers" });
  await settled(crate);
  const box = (await crate.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  await client.send("Input.synthesizeScrollGesture", {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 3),
    xDistance: direction === "left" ? -Math.round(box.width * 0.6) : Math.round(box.width * 0.6),
    yDistance: 0,
    speed: 1200,
  });
  await client.detach();
}

async function saveCopies(page: Page, discogsReleaseIds: number[]) {
  const { collection } = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  for (const discogsReleaseId of discogsReleaseIds) {
    expect((await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId } })).status()).toBe(201);
  }
}

test("a User flips through the covers by swiping, in the list's order, and comes back to the same cover from a Copy", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "crate");
  await saveCopies(page, [2474032, 16893476, 13716287]);
  await page.goto("/?sort=artist");
  await page.getByRole("link", { name: "Browse covers" }).click();

  await expect(page).toHaveURL(/\/browse\?sort=artist$/);
  const position = page.getByRole("status");
  await expect(position).toHaveText("1 of 3: Abbey Road");
  await expect(page.getByRole("listitem", { name: "1 of 3" })).toContainText(/Abbey Road\s*The Beatles\s*213 kr/);

  await swipe(page, "left");
  await expect(position).toHaveText("2 of 3: Discovery");
  await swipe(page, "left");
  await expect(position).toHaveText("3 of 3: Kind Of Blue");
  await swipe(page, "right");
  await expect(position).toHaveText("2 of 3: Discovery");

  await page.getByRole("link", { name: "Discovery" }).click();
  await expect(page.getByRole("heading", { name: "Discovery" })).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/browse\?sort=artist&at=1$/);
  await expect(position).toHaveText("2 of 3: Discovery");
  await expect(page.getByRole("listitem", { name: "2 of 3" })).toBeInViewport({ ratio: 0.9 });

  await page.getByRole("switch", { name: "Values" }).click();
  await expect(page.getByRole("list", { name: "Covers" })).not.toContainText("kr");
});

test("thousands of Copies stay quick: only the covers near the one in view load, and more Copies load ahead of the swipe", async ({ page, logInAsNewUser }) => {
  test.slow();
  await logInAsNewUser(page, "big-crate");
  await saveCopies(page, Array(55).fill(2474032));
  await page.goto("/browse");

  await expect(page.getByRole("status")).toHaveText("1 of 55: Kind Of Blue");
  await expect(page.getByRole("listitem", { name: /of 55$/ })).toHaveCount(50);
  await expect(page.getByRole("list", { name: "Covers" }).locator("img")).toHaveCount(3);

  await page.getByRole("list", { name: "Covers" }).evaluate((crate) => crate.scrollTo({ left: crate.clientWidth * 46, behavior: "instant" }));
  await expect(page.getByRole("status")).toHaveText("47 of 55: Kind Of Blue");
  await expect(page.getByRole("listitem", { name: /of 55$/ })).toHaveCount(55);
  await expect(page.getByRole("list", { name: "Covers" }).locator("img")).toHaveCount(5);
});
