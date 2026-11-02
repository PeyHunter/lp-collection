import { mkdir, writeFile } from "node:fs/promises";
import { chromium, devices, expect, type Page } from "@playwright/test";
import { readState } from "./shared.ts";

const state = await readState(process.argv[2]);
const evidence = `.verify/${state.runId}/evidence`;
await mkdir(evidence, { recursive: true });
const { defaultBrowserType: _, ...iPhone } = devices["iPhone 15"];
const browser = await chromium.launch();
const consoleErrors: string[] = [];

async function shot(page: Page, name: string, locator?: ReturnType<Page["getByRole"]>) {
  await page.evaluate(() => document.fonts.ready);
  if (locator) await locator.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: `${evidence}/${name}.png` });
  console.log(`saved ${name}.png`);
}

async function logIn(username: string, from = "/") {
  const page = await (await browser.newContext({ ...iPhone, baseURL: state.appUrl })).newPage();
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(`${page.url()} ${message.text()}`));
  await page.goto(from);
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill(username);
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: /Collection/ })).toBeVisible();
  return page;
}

const owner = await logIn("owner");
const ownerMe = (await (await owner.request.get("/api/me")).json()) as { collection: { id: string } };
expect((await owner.request.post(`/api/collections/${ownerMe.collection.id}/copies`, { data: { discogsReleaseId: 16893476 } })).status()).toBe(201);
const invite = (await (await owner.request.post("/api/invites")).json()) as { url: string };
const friend = await logIn("friend", new URL(invite.url).pathname);

await owner.reload();
const members = owner.getByRole("region", { name: "Members" });
await members.getByLabel("Add a Member by Discogs username").fill("stranger");
await members.getByRole("button", { name: "Add" }).click();
await expect(members.getByRole("alert")).toContainText("Send them an Invite first");
console.log("adding someone who isn't a User:", await members.getByRole("alert").textContent());
await members.getByLabel("Add a Member by Discogs username").fill("friend");
await members.getByRole("button", { name: "Add" }).click();
await expect(members.getByRole("listitem")).toHaveText([/owner\s*Owner/, /friend\s*Member\s*Remove/]);
console.log("the Owner added friend");
await shot(owner, "owner-members", members);

await friend.reload();
const switcher = friend.getByRole("group", { name: "Collection" });
await expect(switcher.getByRole("radio")).toHaveCount(2);
await shot(friend, "friend-own-collection");
await switcher.getByText("owner's").click();
await expect(friend.getByRole("heading", { name: /owner's Collection/ })).toBeVisible();
await expect(friend.getByRole("region", { name: "Copies" }).getByRole("link", { name: "Discovery" })).toBeVisible();
console.log("friend switched to owner's Collection with one tap and sees its Copies");
await shot(friend, "friend-in-owners-collection");

await owner.reload();
await owner.getByRole("button", { name: "Remove friend" }).click();
await expect(owner.getByRole("region", { name: "Members" }).getByRole("listitem")).toHaveCount(1);
await friend.reload();
await expect(friend.getByRole("heading", { name: /Your Collection/ })).toBeVisible();
await expect(friend.getByRole("group", { name: "Collection" })).toHaveCount(0);
const shut = await friend.request.get(`/api/collections/${ownerMe.collection.id}/copies`);
await writeFile(`${evidence}/removed-member-copies.http.txt`, `GET /api/collections/${ownerMe.collection.id}/copies\nHTTP ${shut.status()}\n${await shut.text()}\n`);
console.log("after removal friend is back in their own Collection; the owner's answers", shut.status());

await writeFile(`${evidence}/console-errors.json`, JSON.stringify(consoleErrors, null, 2));
console.log("console errors:", consoleErrors);
await browser.close();
