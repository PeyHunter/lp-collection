import { expect, test } from "vitest";
import type { CopyView, LookupView } from "../../src/server/collection.ts";
import { sampleReleases } from "../../src/server/fake-discogs.ts";
import { logInWithCollection, saveCopy, type Member } from "../support/members.ts";
import { createShelf as shelf, putIn, sectionAt } from "../support/shelves.ts";
import { createTestApp } from "../support/test-app.ts";

const discovery = 16893476;
const gas5 = 1503928;

async function savedCopy(user: Member, discogsReleaseId = discovery) {
  const response = await saveCopy(user, discogsReleaseId);
  expect(response.status).toBe(201);
  return ((await response.json()) as { copy: CopyView }).copy;
}

async function copy(user: Member, copyId: string) {
  return ((await (await user.as(`/copies/${copyId}`)).json()) as { copy: CopyView }).copy;
}

async function list(user: Member, query = "") {
  const response = await user.as(`/copies${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { copies: CopyView[]; total: number };
}

test("a Copy is put in a Section, moved to another, and taken off the shelf, and its page says where it lives", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const living = await shelf(owner, "Shelf 1");
  const hall = await shelf(owner, "Hall");
  const saved = await savedCopy(owner);
  expect(saved.location).toBeNull();

  await putIn(owner, saved.id, sectionAt(living, 3, 4).id);
  expect((await copy(owner, saved.id)).location).toEqual({ shelfId: living.id, shelfName: "Shelf 1", sectionId: sectionAt(living, 3, 4).id, column: 3, row: 4 });

  await putIn(owner, saved.id, sectionAt(hall, 1, 2).id);
  expect((await copy(owner, saved.id)).location).toMatchObject({ shelfId: hall.id, shelfName: "Hall", column: 1, row: 2 });

  await putIn(owner, saved.id, null);
  expect((await copy(owner, saved.id)).location).toBeNull();
});

test("the Collection list shows where each Copy lives and can show only the Copies Not on a shelf", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const living = await shelf(owner, "Shelf 1");
  const placed = await savedCopy(owner, discovery);
  const loose = await savedCopy(owner, gas5);
  await putIn(owner, placed.id, sectionAt(living, 2, 1).id);

  const all = await list(owner, "?sort=artist");
  expect(all.copies.map((one) => [one.id, one.location?.column ?? null, one.location?.row ?? null])).toEqual([
    [placed.id, 2, 1],
    [loose.id, null, null],
  ]);

  const notOnAShelf = await list(owner, "?shelf=none");
  expect(notOnAShelf.total).toBe(1);
  expect(notOnAShelf.copies.map((one) => one.id)).toEqual([loose.id]);

  await putIn(owner, loose.id, sectionAt(living, 1, 1).id);
  expect((await list(owner, "?shelf=none")).total).toBe(0);
  expect((await owner.as("/copies?shelf=somewhere")).status).toBe(400);
});

test("looking up a record the Collection already has says where each Copy of it lives", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const living = await shelf(owner, "Shelf 1");
  const first = await savedCopy(owner);
  const second = await savedCopy(owner);
  await putIn(owner, first.id, sectionAt(living, 3, 4).id);

  const response = await owner.as("/lookup?barcode=190295328709");
  expect(response.status).toBe(200);
  const [candidate] = ((await response.json()) as LookupView).candidates;
  expect(candidate).toMatchObject({ discogsReleaseId: discovery, copiesInCollection: 2 });
  expect(candidate!.held).toEqual(
    expect.arrayContaining([
      { copyId: first.id, location: { shelfId: living.id, shelfName: "Shelf 1", sectionId: sectionAt(living, 3, 4).id, column: 3, row: 4 } },
      { copyId: second.id, location: null },
    ]),
  );
  expect(candidate!.held).toHaveLength(2);
});
