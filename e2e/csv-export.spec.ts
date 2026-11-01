import { readFile } from "node:fs/promises";
import { expect, test } from "./login.ts";

test("the Collection downloads as a CSV spreadsheet with Danish letters intact", async ({ page, logInAsNewUser }) => {
  await logInAsNewUser(page, "spreadsheet");
  const { collection } = (await (await page.request.get("/api/me")).json()) as { collection: { id: string } };
  const created = await page.request.post(`/api/collections/${collection.id}/copies`, { data: { discogsReleaseId: 2474032 } });
  const { copy } = (await created.json()) as { copy: { id: string } };
  await page.request.patch(`/api/collections/${collection.id}/copies/${copy.id}`, { data: { note: "Købt på Ærø", purchasePrice: { amount: 100, currency: "DKK" } } });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Copies" }).getByRole("link")).toHaveText(["Kind Of Blue"]);

  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download as spreadsheet (CSV)" }).click();
  const download = await downloading;

  expect(download.suggestedFilename()).toMatch(/^lp-collection-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = (await readFile(await download.path())).toString("utf8");
  const [header, row] = text.replace(/^﻿/, "").split("\r\n");
  expect(header).toMatch(/^Artist,Title,.*,Value,.*,Gain,Note$/);
  expect(row).toMatch(/^Miles Davis,Kind Of Blue,.*,DKK,100\.00,DKK,-?\d+\.\d{2},Købt på Ærø$/);
});
