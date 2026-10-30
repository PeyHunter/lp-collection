import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, devices, expect, type APIResponse, type Page } from "@playwright/test";

const runId = process.argv[2];
if (!runId) throw new Error("Usage: node .claude/skills/verify-lp-collection/bin/drive-photos.ts <run-id>");
const state = JSON.parse(await readFile(`.verify/${runId}/state.json`, "utf8")) as { appUrl: string };
const evidence = `.verify/${runId}/evidence`;
await mkdir(evidence, { recursive: true });
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
const browser = await chromium.launch();
const consoleErrors: string[] = [];

async function newPage() {
  const context = await browser.newContext({ ...iPhone, baseURL: state.appUrl });
  const page = await context.newPage();
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(`${page.url()} ${message.text()}`));
  return page;
}

async function shot(page: Page, name: string, scrollTo?: string) {
  if (scrollTo) await page.getByRole("region", { name: scrollTo }).evaluate((region) => region.scrollIntoView({ block: "start" }));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${evidence}/${name}.png` });
  console.log(`saved ${name}.png`);
}

async function saveHttp(name: string, response: APIResponse) {
  const headers = Object.entries(response.headers())
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const type = response.headers()["content-type"] ?? "";
  const body = type.startsWith("application/json") ? JSON.stringify(await response.json(), null, 2) : `<${(await response.body()).length} bytes of ${type}>`;
  await writeFile(`${evidence}/${name}.http.txt`, `HTTP ${response.status()}\n${headers}\n\n${body}\n`);
  console.log(`saved ${name}.http.txt (HTTP ${response.status()})`);
}

async function logIn(page: Page, username: string) {
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill(username);
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
}

async function add(page: Page, barcode: string, pick?: string) {
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill(barcode);
  await page.getByRole("button", { name: "Look up" }).click();
  if (pick) await page.getByRole("listitem").filter({ hasText: pick }).getByRole("button", { name: "Kind Of Blue" }).click();
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toContainText("to your Collection.");
}

async function photoOfRecord(page: Page, labelColor: string, angle: number) {
  const base64 = await page.evaluate(
    async ([labelColor, angle]) => {
      const canvas = new OffscreenCanvas(4032, 3024);
      const context = canvas.getContext("2d")!;
      const wood = context.createLinearGradient(0, 0, 4032, 3024);
      wood.addColorStop(0, "#8a5a36");
      wood.addColorStop(1, "#4a2c18");
      context.fillStyle = wood;
      context.fillRect(0, 0, 4032, 3024);
      for (let y = 0; y < 3024; y += 37) {
        context.fillStyle = `rgba(30, 15, 5, ${0.08 + 0.08 * Math.sin(y)})`;
        context.fillRect(0, y, 4032, 9);
      }
      context.translate(2016, 1512);
      context.rotate(angle);
      context.fillStyle = "#d9cdb4";
      context.fillRect(-1450, -1350, 2700, 2700);
      context.fillStyle = "rgba(60, 40, 20, 0.25)";
      context.fillRect(-1450, -1350, 2700, 140);
      context.beginPath();
      context.arc(300, 0, 1250, 0, 2 * Math.PI);
      context.fillStyle = "#0d0d0d";
      context.fill();
      for (let radius = 520; radius < 1240; radius += 14) {
        context.beginPath();
        context.arc(300, 0, radius, 0, 2 * Math.PI);
        context.strokeStyle = radius % 3 ? "#1c1c1c" : "#262626";
        context.lineWidth = 4;
        context.stroke();
      }
      context.beginPath();
      context.arc(300, 0, 430, 0, 2 * Math.PI);
      context.fillStyle = labelColor;
      context.fill();
      context.beginPath();
      context.arc(300, 0, 40, 0, 2 * Math.PI);
      context.fillStyle = "#0d0d0d";
      context.fill();
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
    },
    [labelColor, angle] as const,
  );
  return { name: "IMG_4032.PNG", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

const owner = await newPage();
await owner.goto("/");
await logIn(owner, "owner");
await add(owner, "886979891211", "Sony Music");
await add(owner, "190295328709");
await owner.goto("/");
const rows = owner.getByRole("region", { name: "Copies" }).getByRole("listitem");

await rows.filter({ hasText: "Discovery" }).getByRole("link", { name: "Discovery" }).click();
const photos = owner.getByRole("region", { name: "Photos" });
await expect(photos).toContainText("No photos yet.");
await expect(owner.locator(".big-cover")).toHaveAttribute("src", "/fake-discogs/covers/16893476.svg");
await shot(owner, "copy-without-photos");
await shot(owner, "copy-without-photos-section", "Photos");

let releaseUpload: () => void = () => {};
const uploadHeld = new Promise<void>((resolve) => (releaseUpload = resolve));
await owner.route("**/photos", async (route) => {
  await uploadHeld;
  await route.continue();
});
const firstPhoto = await photoOfRecord(owner, "#c0392b", -0.06);
await photos.getByLabel("Take or pick a photo").setInputFiles(firstPhoto);
await expect(photos.getByText("Adding photo…")).toBeVisible();
await shot(owner, "taking-photo-adding", "Photos");
releaseUpload();
await expect(photos.getByRole("img", { name: "Photo 1 of Discovery" })).toBeVisible();
await owner.unroute("**/photos");
await photos.getByLabel("Take or pick a photo").setInputFiles(await photoOfRecord(owner, "#f1c40f", 0.12));
await expect(photos.getByRole("img", { name: "Photo 2 of Discovery" })).toBeVisible();
const firstUrl = await photos.getByRole("img", { name: "Photo 1 of Discovery" }).getAttribute("src");
await expect(owner.locator(".big-cover")).toHaveAttribute("src", firstUrl!);
console.log("uploaded 4032x3024 PNG, served at", firstUrl, "naturalWidth", await photos.getByRole("img", { name: "Photo 1 of Discovery" }).evaluate((image: HTMLImageElement) => `${image.naturalWidth}x${image.naturalHeight}`));
await owner.reload();
await expect(photos.getByRole("img", { name: "Photo 2 of Discovery" })).toBeVisible();
await owner.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))));
await shot(owner, "copy-with-photos");
await shot(owner, "copy-with-photos-section", "Photos");

await photos.getByRole("button", { name: "Delete photo 2" }).click();
await shot(owner, "delete-photo-confirm", "Photos");
await photos.getByRole("group", { name: "Delete this photo?" }).getByRole("button", { name: "Delete" }).click();
await expect(photos.getByRole("img")).toHaveCount(1);

await owner.getByRole("link", { name: "Back" }).click();
await expect(rows.filter({ hasText: "Discovery" }).locator("img")).toHaveAttribute("src", firstUrl!);
await owner.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))));
await shot(owner, "collection-photo-thumbnail");

await saveHttp("photo-as-member", await owner.request.get(firstUrl!));
const me = (await (await owner.request.get("/api/me")).json()) as { collection: { id: string } };
await saveHttp("copies", await owner.request.get(`/api/collections/${me.collection.id}/copies`));

await owner.getByRole("button", { name: "Create Invite" }).click();
const inviteUrl = await owner.getByLabel("Invite link").inputValue();
const friend = await newPage();
await friend.goto(inviteUrl);
await logIn(friend, `friend-${runId}`);
const notMember = await friend.request.get(firstUrl!);
expect(notMember.status()).toBe(404);
await saveHttp("photo-as-non-member", notMember);
const loggedOut = await browser.newContext({ baseURL: state.appUrl });
await saveHttp("photo-logged-out", await loggedOut.request.get(firstUrl!));

await rows.filter({ hasText: "Discovery" }).getByRole("link", { name: "Discovery" }).click();
await owner.getByRole("button", { name: "Delete this Copy" }).click();
const confirm = owner.getByRole("group", { name: "Delete Discovery and its photo? This can't be undone." });
await expect(confirm.getByRole("button", { name: "Delete Copy" })).toBeInViewport();
await shot(owner, "delete-copy-confirm");
await confirm.getByRole("button", { name: "Delete Copy" }).click();
await expect(owner.getByRole("status")).toHaveText("Deleted Discovery from your Collection.");
await expect(rows).toHaveCount(1);
await shot(owner, "collection-after-delete");
await saveHttp("photo-after-copy-deleted", await owner.request.get(firstUrl!));

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
