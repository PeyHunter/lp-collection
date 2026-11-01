import { expect, test } from "vitest";
import type { CopyView, LookupView } from "../../src/server/collection.ts";
import { sampleReleases } from "../../src/server/fake-discogs.ts";
import { logInWithCollection, saveCopy, type Member } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";
import { createShelf, putIn, sectionAt } from "../support/shelves.ts";

const discovery = { id: 16893476, barcode: "190295328709" };

async function scan(user: Member, barcode: string) {
  const response = await user.as(`/lookup?barcode=${barcode}`);
  expect(response.status).toBe(200);
  return (await response.json()) as LookupView;
}

async function savedCopy(user: Member, discogsReleaseId: number) {
  return ((await (await saveCopy(user, discogsReleaseId)).json()) as { copy: CopyView }).copy;
}

const addInto = (user: Member, discogsReleaseId: number, sectionId: unknown) =>
  user.as("/copies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ discogsReleaseId, sectionId }) });

test("a run of scans finds each held Copy and places it, and a record with two Copies offers both", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const shelf = await createShelf(owner, "Shelf 1");
  const b2 = sectionAt(shelf, 2, 2);
  const ownBarcode = (barcode: string) => sampleReleases.filter((release) => release.barcodes.includes(barcode)).length === 1;
  const withBarcodes = sampleReleases.filter((release) => release.barcodes.length > 0 && ownBarcode(release.barcodes[0]!)).slice(0, 3);
  expect(withBarcodes).toHaveLength(3);
  const held = [];
  for (const release of withBarcodes) held.push(await savedCopy(owner, release.discogsReleaseId));

  for (const release of withBarcodes) {
    const [candidate] = (await scan(owner, release.barcodes[0]!)).candidates;
    expect(candidate!.held).toHaveLength(1);
    await putIn(owner, candidate!.held[0]!.copyId, b2.id);
  }
  const shelves = (await (await owner.as("/shelves")).json()) as { shelves: { sections: { id: string; copyCount: number }[] }[] };
  expect(shelves.shelves[0]!.sections.find((section) => section.id === b2.id)!.copyCount).toBe(held.length);

  const second = await savedCopy(owner, withBarcodes[0]!.discogsReleaseId);
  const [twice] = (await scan(owner, withBarcodes[0]!.barcodes[0]!)).candidates;
  expect(Object.fromEntries(twice!.held.map((copy) => [copy.copyId, copy.location?.sectionId ?? null]))).toEqual({ [held[0]!.id]: b2.id, [second.id]: null });
});

test("a record the Collection doesn't have yet is added straight into the Section", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const shelf = await createShelf(owner, "Shelf 1");
  const [candidate] = (await scan(owner, discovery.barcode)).candidates;
  expect(candidate!.held).toEqual([]);

  const response = await addInto(owner, discovery.id, sectionAt(shelf, 1, 3).id);
  expect(response.status).toBe(201);
  const { copy } = (await response.json()) as { copy: CopyView };
  expect(copy.location).toMatchObject({ shelfName: "Shelf 1", column: 1, row: 3 });
});

test("a new Copy can't be put in a Section that isn't the Collection's, and nothing is saved", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  await createShelf(owner, "Shelf 1");

  expect((await addInto(owner, discovery.id, "not-a-section")).status).toBe(400);
  expect((await addInto(owner, discovery.id, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
  expect(((await (await owner.as("/copies")).json()) as { total: number }).total).toBe(0);
});
