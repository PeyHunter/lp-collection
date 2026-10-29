// THROWAWAY PROTOTYPE tooling. Run from the repo root: node prototypes/gig-poster/shoot.mjs
// Screenshots every screen at iPhone 15 size in dark mode, and fails on sideways scroll,
// missing fonts, or tap targets under 44px.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { chromium, devices } = createRequire(path.join(process.cwd(), "package.json"))("@playwright/test");

const dir = path.dirname(fileURLToPath(import.meta.url));
const shots = [
  ["home", "home.html"],
  ["collection", "collection.html"],
  ["collection-period", "collection.html?sort=period"],
  ["lookup", "lookup.html"],
  ["copy", "copy.html"],
  ["shelf", "shelf.html"],
];

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 15"], viewport: { width: 393, height: 852 }, colorScheme: "dark" });
let failed = false;

for (const [name, file] of shots) {
  const page = await context.newPage();
  page.on("pageerror", (error) => { failed = true; console.log(`${name}: page error ${error.message}`); });
  await page.goto(`file://${path.join(dir, file)}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const report = await page.evaluate(() => {
    const root = document.documentElement;
    const visible = (el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.opacity !== "0" && box.width > 0 && box.height > 0;
    };
    const targets = [...document.querySelectorAll("a, button, select, input, textarea, label.chip")]
      .filter((el) => !el.closest("label.chip") || el.matches("label.chip"))
      .filter(visible)
      .map((el) => {
        const box = (el.closest(".row:has(.row-link)") && el.matches(".row-link") ? el.closest(".row") : el).getBoundingClientRect();
        return { el, w: box.width, h: box.height };
      })
      .filter(({ w, h }) => w < 43.5 || h < 43.5)
      .map(({ el, w, h }) => `${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 30)}" ${w.toFixed(0)}x${h.toFixed(0)}`);
    return {
      fonts: [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family))],
      sideways: root.scrollWidth - root.clientWidth,
      overflowing: [...document.querySelectorAll("body *")]
        .filter((el) => visible(el) && el.getBoundingClientRect().right > root.clientWidth + 0.5)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
      smallTargets: targets,
    };
  });

  const missingFonts = ["Unbounded", "Instrument Sans"].filter((f) => !report.fonts.some((loaded) => loaded.includes(f)));
  const problems = [
    ...missingFonts.map((f) => `font not loaded: ${f}`),
    ...(report.sideways > 0 ? [`scrolls sideways by ${report.sideways}px`] : []),
    ...report.overflowing.map((s) => `past the right edge: ${s}`),
    ...report.smallTargets.map((s) => `tap target under 44px: ${s}`),
  ];
  if (problems.length) failed = true;
  console.log(`${name}: ${problems.length ? `\n  ${problems.join("\n  ")}` : "ok"}`);

  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 393, height: fullHeight });
  await page.screenshot({ path: path.join(dir, "screenshots", `${name}.png`), fullPage: true });
  await page.close();
}

await browser.close();
process.exitCode = failed ? 1 : 0;
