// Draws the home-screen icons from icon.svg with Chromium, so they use the app's own oklch colors.
// Run from the repo root after changing the SVG: node scripts/icons/make-icons.ts
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const svg = await readFile(new URL("./icon.svg", import.meta.url), "utf8");
/** `maskable` keeps the record inside the middle 80%, the part every launcher mask shows. */
const sizes = [
  { file: "apple-touch-icon.png", size: 180, scale: 1 },
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.78 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, scale } of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:oklch(24% 0.04 50)">
    <div style="width:${size}px;height:${size}px;display:grid;place-items:center">
      <div style="width:${size * scale}px;height:${size * scale}px">${svg}</div>
    </div></body></html>`);
  await page.screenshot({ path: `src/web/public/icons/${file}`, omitBackground: false });
  console.log(`src/web/public/icons/${file}`);
}
await browser.close();
