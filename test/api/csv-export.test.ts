import { expect, test } from "vitest";
import { priceLadder, type FakeRelease } from "../../src/server/fake-discogs.ts";
import { invitedFriend, logInWithCollection, saveCopy } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

const gas5: FakeRelease = {
  discogsReleaseId: 5,
  artist: "Gasolin'",
  title: "Gas 5 – Kær Øl, \"Åh\"",
  label: "CBS",
  catalogNumber: "CBS 69209",
  country: "Denmark",
  pressingYear: 1976,
  originalYear: 1975,
  coverImageUrl: null,
  format: null,
  genres: ["Rock"],
  styles: [],
  barcodes: [],
};
const demo: FakeRelease = { ...gas5, discogsReleaseId: 7, artist: "Ukendt", title: "Demo", label: null, catalogNumber: null, country: null, pressingYear: null, originalYear: null };

const header = "Artist,Title,Label,Catalog number,Original year,Pressing year,Media condition,Sleeve condition,Value,Lowest listing,Currency,Purchase price,Purchase currency,Gain,Note";

async function collection() {
  const app = await createTestApp({ discogs: { releases: [gas5, demo], prices: { 5: priceLadder(200, "EUR") }, lowestListings: { 5: { amount: 150, currency: "DKK" } } } });
  const owner = await logInWithCollection(app);
  const saved = (await (await saveCopy(owner, 5)).json()) as { copy: { id: string } };
  app.clock.advance(60_000);
  await saveCopy(owner, 7);
  await owner.as(`/copies/${saved.copy.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ note: "=Fra fars hylde;\nlille splitning", purchasePrice: { amount: 100, currency: "DKK" }, purchaseDate: "2019-03-12" }),
  });
  return { app, owner };
}

/** Excel needs the UTF-8 byte order mark to read Danish letters, so the bytes are checked before decoding. */
async function rowsOf(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder().decode(bytes).split("\r\n");
}

test("the CSV export has a header, one row per Copy sorted by artist, Danish characters intact, and quoted fields", async () => {
  const { owner } = await collection();

  const response = await owner.as("/export.csv");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="lp-collection-2026-03-01.csv"');
  const rows = await rowsOf(response);
  expect(rows[0]).toBe(header);
  expect(rows[1]).toBe(
    `Gasolin',"Gas 5 – Kær Øl, ""Åh""",CBS,CBS 69209,1975,1976,Very Good Plus (VG+),Very Good Plus (VG+),1119.00,150.02,DKK,100.00,DKK,1019.00,"'=Fra fars hylde;\nlille splitning"`,
  );
  expect(rows[2]).toBe("Ukendt,Demo,,,,,Very Good Plus (VG+),Very Good Plus (VG+),,,,,,,");
  expect(rows[3]).toBe("");
  expect(rows).toHaveLength(4);
});

test("with Values hidden the CSV leaves out every Value column", async () => {
  const { app, owner } = await collection();
  await app.request("/api/me/show-values", { method: "PUT", headers: { cookie: owner.session, "content-type": "application/json" }, body: JSON.stringify({ showValues: false }) });

  const rows = await rowsOf(await owner.as("/export.csv"));

  expect(rows[0]).toBe("Artist,Title,Label,Catalog number,Original year,Pressing year,Media condition,Sleeve condition,Note");
  expect(rows[1]).toBe(`Gasolin',"Gas 5 – Kær Øl, ""Åh""",CBS,CBS 69209,1975,1976,Very Good Plus (VG+),Very Good Plus (VG+),"'=Fra fars hylde;\nlille splitning"`);
});

test("only Members of the Collection can export it", async () => {
  const { app, owner } = await collection();
  const stranger = await invitedFriend(app, owner.session, "stranger");

  const anonymous = await app.request(`/api/collections/${owner.collectionId}/export.csv`);
  const notAMember = await app.request(`/api/collections/${owner.collectionId}/export.csv`, { headers: { cookie: stranger.session } });

  expect(anonymous.status).toBe(401);
  expect(notAMember.status).toBe(404);
});
