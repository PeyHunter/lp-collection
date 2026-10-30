import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, devices, expect, type APIResponse, type Page } from "@playwright/test";
import { drawnCorners, drawShelfPhoto } from "../../../../e2e/shelf-photo.ts";
import type { ShelfView } from "../../../../src/server/shelves.ts";

const runId = process.argv[2];
if (!runId) throw new Error("Usage: node .claude/skills/verify-lp-collection/bin/drive-shelf.ts <run-id>");
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

async function add(page: Page, barcode: string) {
  await page.getByRole("link", { name: "Scan" }).click();
  await page.getByRole("textbox", { name: "Barcode" }).fill(barcode);
  await page.getByRole("button", { name: "Look up" }).click();
  await page.getByRole("button", { name: "Add to Collection" }).click();
  await expect(page.getByRole("status")).toContainText("to your Collection.");
  return ((await (await page.request.get(`/api/collections/${collectionId}/copies`)).json()) as { copies: { id: string }[] }).copies[0]!.id;
}

async function dragCorners(page: Page) {
  const frame = (await page.getByRole("img", { name: "Shelf photo with its squares drawn over it" }).boundingBox())!;
  for (const [index, name] of ["Top left", "Top right", "Bottom right", "Bottom left"].entries()) {
    const dot = (await page.getByRole("button", { name: `${name} corner. Drag it, or use the arrow keys.` }).boundingBox())!;
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await page.mouse.down();
    await page.mouse.move(frame.x + drawnCorners[index]!.x * frame.width, frame.y + drawnCorners[index]!.y * frame.height, { steps: 8 });
    await page.mouse.up();
  }
}

const owner = await newPage();
await owner.goto("/");
await logIn(owner, "owner");
const me = (await (await owner.request.get("/api/me")).json()) as { collection: { id: string } };
const collectionId = me.collection.id;
const shelvesApi = `/api/collections/${collectionId}/shelves`;
const discovery = await add(owner, "190295328709");
const second = await add(owner, "5099969209017");

await owner.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Shelves" }).click();
await expect(owner.getByText("No Shelves yet.")).toBeVisible();
await expect(owner.getByText("2 Copies are Not on a shelf.")).toBeVisible();
await shot(owner, "shelves-empty");

await owner.getByRole("link", { name: "Set up a Shelf" }).click();
await expect(owner.getByRole("heading", { name: "New Shelf" })).toBeVisible();
await expect(owner.getByLabel("Shelf name")).toHaveValue("Shelf 1");
await shot(owner, "shelf-new-no-photo");

await owner.getByLabel("Take or pick a photo").setInputFiles({ name: "IMG_5120.JPG", mimeType: "image/jpeg", buffer: await drawShelfPhoto(owner) });
const photo = owner.getByRole("img", { name: "Shelf photo with its squares drawn over it" });
await expect(photo.locator(".cell")).toHaveCount(24);
await shot(owner, "shelf-new-photo-picked");
await dragCorners(owner);
await shot(owner, "shelf-corners-lined-up");
await owner.getByLabel("Shelf name").fill("Living room");
await shot(owner, "shelf-new-ready-to-save", "Save");
await owner.getByRole("button", { name: "Save Shelf" }).click();
const row = owner.getByRole("listitem").filter({ hasText: "Living room" });
await expect(row).toContainText("4 × 6 · 24 Sections");
await owner.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))));
await shot(owner, "shelves-list");

const created = ((await (await owner.request.get(shelvesApi)).json()) as { shelves: ShelfView[] }).shelves[0]!;
const section = (column: number, row: number) => created.sections.find((each) => each.column === column && each.row === row)!.id;
const putIn = (copyId: string, sectionId: string) => owner.request.put(`/api/collections/${collectionId}/copies/${copyId}/section`, { data: { sectionId } });
expect((await putIn(discovery, section(4, 6))).status()).toBe(204);
expect((await putIn(second, section(3, 4))).status()).toBe(204);
await saveHttp("shelf-with-two-copies", await owner.request.get(`${shelvesApi}/${created.id}`));

await row.getByRole("link", { name: "Living room" }).click();
await expect(owner.getByRole("heading", { name: "Living room" })).toBeVisible();
await owner.evaluate(() => Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))));
await shot(owner, "shelf-edit");
await owner.setViewportSize({ width: 820, height: 1180 });
await shot(owner, "shelf-edit-wide");
await owner.setViewportSize(iPhone.viewport);

await owner.getByLabel("Retake photo").setInputFiles({ name: "IMG_5121.JPG", mimeType: "image/jpeg", buffer: await drawShelfPhoto(owner) });
await owner.getByRole("button", { name: "One row fewer" }).click();
await expect(owner.getByText("1 Copy is in squares outside the new grid. Saving moves it to Not on a shelf.")).toBeVisible();
await expect(owner.getByRole("button", { name: "Save Shelf" })).toBeEnabled({ timeout: 60_000 });
await shot(owner, "shelf-shrink-warning", "Save");
await owner.getByRole("button", { name: "Save Shelf" }).click();
await expect(row).toContainText("4 × 5 · 20 Sections");
await expect(row).toContainText("1 Copy");
await expect(owner.getByText("1 Copy is Not on a shelf.")).toBeVisible();
await owner.reload();
await expect(row).toContainText("4 × 5 · 20 Sections");
await shot(owner, "shelves-after-shrink");
const reshaped = ((await (await owner.request.get(`${shelvesApi}/${created.id}`)).json()) as { shelf: ShelfView }).shelf;
const kept = created.sections.filter((each) => each.row <= 5);
expect(reshaped.sections.map((each) => each.id).sort()).toEqual(kept.map((each) => each.id).sort());
expect(reshaped.photo.url).not.toBe(created.photo.url);
await saveHttp("shelf-after-retake-and-shrink", await owner.request.get(`${shelvesApi}/${created.id}`));
await saveHttp("old-photo-after-retake", await owner.request.get(created.photo.url));
await saveHttp("photo-as-member", await owner.request.get(reshaped.photo.url));

await owner.goto("/");
await owner.getByRole("button", { name: "Create Invite" }).click();
const inviteUrl = await owner.getByLabel("Invite link").inputValue();
const friend = await newPage();
await friend.goto(inviteUrl);
await logIn(friend, `friend-${runId}`);
await saveHttp("shelf-as-non-member", await friend.request.get(`${shelvesApi}/${created.id}`));
await saveHttp("photo-as-non-member", await friend.request.get(reshaped.photo.url));
const loggedOut = await browser.newContext({ baseURL: state.appUrl });
await saveHttp("shelves-logged-out", await loggedOut.request.get(shelvesApi));

await owner.goto(`/shelves/${created.id}`);
await owner.getByRole("button", { name: "Delete this Shelf" }).click();
const confirm = owner.getByRole("group", { name: "Delete Living room? Its 1 Copy moves to Not on a shelf." });
await expect(confirm).toBeInViewport();
await shot(owner, "shelf-delete-confirm");
await confirm.getByRole("button", { name: "Delete" }).click();
await expect(owner.getByText("No Shelves yet.")).toBeVisible();
await expect(owner.getByText("2 Copies are Not on a shelf.")).toBeVisible();
await shot(owner, "shelves-after-delete");
await saveHttp("shelves-after-delete", await owner.request.get(shelvesApi));
await saveHttp("photo-after-delete", await owner.request.get(reshaped.photo.url));

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
