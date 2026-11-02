import { mkdir, writeFile } from "node:fs/promises";
import { chromium, devices, expect, type Locator, type Page } from "@playwright/test";
import { readState } from "./shared.ts";

const state = await readState(process.argv[2]);
const evidence = `.verify/${state.runId}/evidence`;
await mkdir(evidence, { recursive: true });
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
const browser = await chromium.launch();
const consoleErrors: string[] = [];
const context = await browser.newContext({ ...iPhone, baseURL: state.appUrl });
const page = await context.newPage();
page.on("console", (message) => message.type() === "error" && consoleErrors.push(`${page.url()} ${message.text()}`));
const position = page.getByRole("status");
const crate = page.getByRole("list", { name: "Covers" });

async function shot(name: string) {
  await page.evaluate(() => document.fonts.ready);
  await settled(crate);
  await page.screenshot({ path: `${evidence}/${name}.png` });
  console.log(`saved ${name}.png`);
}

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

/** A swipe through Chromium's gesture input, which scroll snapping finishes, as on a phone. */
async function swipe(target: Page, direction: "left" | "right") {
  await settled(crate);
  const box = (await crate.boundingBox())!;
  const client = await target.context().newCDPSession(target);
  const distance = Math.round(box.width * 0.6);
  await client.send("Input.synthesizeScrollGesture", { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 3), xDistance: direction === "left" ? -distance : distance, yDistance: 0, speed: 1200 });
  await client.detach();
}

await page.goto("/");
await page.getByRole("link", { name: "Log in with Discogs" }).click();
await page.getByLabel("Discogs username").fill("owner");
await page.getByRole("button", { name: "Authorize" }).click();
await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();

const me = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
const api = `/api/collections/${me.collection.id}`;
for (const discogsReleaseId of [2474032, 16893476, 13716287, 1046716, 3133906]) {
  expect((await page.request.post(`${api}/copies`, { data: { discogsReleaseId } })).status()).toBe(201);
}

await page.goto("/?sort=artist");
await page.getByRole("link", { name: "Browse covers" }).click();
await expect(page).toHaveURL(/\/browse\?sort=artist$/);
await expect(position).toContainText("1 of 5");
console.log("opened from the list sorted by artist:", await position.textContent());
await shot("browse-first");

await swipe(page, "left");
await expect(position).toContainText("2 of 5");
await swipe(page, "left");
await expect(position).toContainText("3 of 5");
console.log("after two swipes left:", await position.textContent());
await shot("browse-third");
await swipe(page, "right");
await expect(position).toContainText("2 of 5");
console.log("after a swipe right:", await position.textContent());

const title = (await position.textContent())!.split(": ")[1]!;
await page.getByRole("listitem", { name: "2 of 5" }).getByRole("link").click();
await expect(page.getByRole("heading", { name: title })).toBeVisible();
await page.getByRole("link", { name: "Back" }).click();
await expect(position).toContainText(`2 of 5: ${title}`);
console.log(`tapped ${title}, then Back lands on the same cover at ${new URL(page.url()).search}`);

await page.getByRole("switch", { name: "Values" }).click();
await expect(crate).not.toContainText("kr");
await shot("browse-values-off");
await page.getByRole("switch", { name: "Values" }).click();

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
