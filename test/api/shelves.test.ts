import { readdir, readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import type { CopyView } from "../../src/server/collection.ts";
import type { ShelfCorners } from "../../src/server/schema.ts";
import type { ShelfView } from "../../src/server/shelves.ts";
import { sampleReleases } from "../../src/server/fake-discogs.ts";
import { invitedFriend, logInWithCollection, saveCopy, type Member, type TestApp } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

const photo = await readFile(new URL("../fixtures/photo.jpg", import.meta.url));
const discovery = 16893476;

const corners: ShelfCorners = [
  { x: 0.2, y: 0.1 },
  { x: 0.7, y: 0.2 },
  { x: 0.8, y: 0.85 },
  { x: 0.1, y: 0.9 },
];

type ShelfForm = { name?: string; columns?: unknown; rows?: unknown; corners?: unknown; photo?: Uint8Array | null };

function form({ name = "Living room", columns = 4, rows = 6, corners: dots = corners, photo: jpeg = photo }: ShelfForm) {
  const body = new FormData();
  body.set("name", name);
  body.set("columns", String(columns));
  body.set("rows", String(rows));
  body.set("corners", JSON.stringify(dots));
  if (jpeg) body.set("photo", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "shelf.jpg");
  return body;
}

const create = (user: Member, fields: ShelfForm = {}) => user.as("/shelves", { method: "POST", body: form(fields) });
const edit = (user: Member, shelfId: string, fields: ShelfForm) => user.as(`/shelves/${shelfId}`, { method: "PUT", body: form({ photo: null, ...fields }) });

async function created(user: Member, fields: ShelfForm = {}) {
  const response = await create(user, fields);
  expect(response.status).toBe(201);
  return ((await response.json()) as { shelf: ShelfView }).shelf;
}

async function edited(user: Member, shelfId: string, fields: ShelfForm) {
  const response = await edit(user, shelfId, fields);
  expect(response.status).toBe(200);
  return (await response.json()) as { shelf: ShelfView; movedToNotOnAShelf: number };
}

async function shelfList(user: Member) {
  const response = await user.as("/shelves");
  expect(response.status).toBe(200);
  return (await response.json()) as { shelves: ShelfView[]; notOnAShelf: number };
}

async function savedCopy(user: Member) {
  const response = await saveCopy(user, discovery);
  expect(response.status).toBe(201);
  return ((await response.json()) as { copy: CopyView }).copy;
}

const putIn = (user: Member, copyId: string, sectionId: string | null) =>
  user.as(`/copies/${copyId}/section`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sectionId }) });

const sectionAt = (shelf: ShelfView, column: number, row: number) => shelf.sections.find((section) => section.column === column && section.row === row)!;
const grid = (shelf: ShelfView) => shelf.sections.map(({ column, row }) => `${column},${row}`).sort();
const storedFiles = (app: TestApp) => readdir(app.photosDir);

test("a Member sets up a Shelf from a photo, and it has one Section per square", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const shelf = await created(owner, { name: "  Living room  " });

  expect(shelf).toMatchObject({ name: "Living room", columns: 4, rows: 6, corners, photo: { width: 64, height: 48 } });
  expect(shelf.sections).toHaveLength(24);
  expect(new Set(shelf.sections.map((section) => section.id)).size).toBe(24);
  expect(shelf.sections.every((section) => section.copyCount === 0)).toBe(true);
  const fetched = await app.request(shelf.photo.url, { headers: { cookie: owner.session } });
  expect(fetched.status).toBe(200);
  expect(fetched.headers.get("content-type")).toBe("image/jpeg");
  expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(new Uint8Array(photo));
  expect(await shelfList(owner)).toEqual({ shelves: [shelf], notOnAShelf: 0 });
  expect(await (await owner.as(`/shelves/${shelf.id}`)).json()).toEqual({ shelf });
});

test("a Collection can have several Shelves, listed in the order they were set up", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const wall = await created(owner, { name: "Wall" });
  app.clock.advance(1000);
  const hall = await created(owner, { name: "Hall", columns: 2, rows: 2 });

  expect((await shelfList(owner)).shelves.map((shelf) => [shelf.name, shelf.sections.length])).toEqual([
    [wall.name, 24],
    [hall.name, 4],
  ]);
  expect(await storedFiles(app)).toHaveLength(2);
});

test("a Shelf without a name, a photo, a sensible grid or four corners in order is refused and stores nothing", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");

  const responses = [
    await create(owner, { name: "   " }),
    await create(owner, { photo: null }),
    await create(owner, { photo: png }),
    await create(owner, { columns: 0 }),
    await create(owner, { rows: 27 }),
    await create(owner, { columns: 2.5 }),
    await create(owner, { corners: corners.slice(0, 3) }),
    await create(owner, { corners: [corners[0], corners[2], corners[1], corners[3]] }),
    await create(owner, { corners: [{ x: -0.5, y: 0 }, ...corners.slice(1)] }),
    await owner.as("/shelves", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  ];

  expect(responses.map((response) => response.status)).toEqual([400, 400, 415, 400, 400, 400, 400, 400, 400, 400]);
  expect(await responses[7]!.json()).toEqual({ error: "Drag the four dots onto the shelf's outer corners: top left, top right, bottom right, bottom left." });
  expect((await shelfList(owner)).shelves).toEqual([]);
  expect(await storedFiles(app)).toEqual([]);
});

test("renaming, moving the corners and retaking the photo keep every Section and the Copies in it", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const shelf = await created(owner);
  const copy = await savedCopy(owner);
  const c4 = sectionAt(shelf, 3, 4);
  expect((await putIn(owner, copy.id, c4.id)).status).toBe(204);
  const moved: ShelfCorners = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];

  const renamed = await edited(owner, shelf.id, { name: "Records", corners: moved });
  const retaken = await edited(owner, shelf.id, { name: "Records", corners: moved, photo });

  expect(renamed).toMatchObject({ shelf: { name: "Records", corners: moved, photo: shelf.photo }, movedToNotOnAShelf: 0 });
  expect(retaken.shelf.photo.url).not.toBe(shelf.photo.url);
  expect(retaken.shelf.sections).toEqual(shelf.sections.map((section) => (section.id === c4.id ? { ...section, copyCount: 1 } : section)));
  expect((await app.request(shelf.photo.url, { headers: { cookie: owner.session } })).status).toBe(404);
  expect((await app.request(retaken.shelf.photo.url, { headers: { cookie: owner.session } })).status).toBe(200);
  expect(await storedFiles(app)).toHaveLength(1);
});

test("growing the grid keeps every Section and adds the new squares", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const shelf = await created(owner, { columns: 2, rows: 2 });

  const { shelf: grown, movedToNotOnAShelf } = await edited(owner, shelf.id, { columns: 3, rows: 4 });

  expect(movedToNotOnAShelf).toBe(0);
  expect(grown.sections).toHaveLength(12);
  for (const section of shelf.sections) expect(sectionAt(grown, section.column, section.row).id).toBe(section.id);
});

test("shrinking the grid removes the Sections outside it and moves their Copies to Not on a shelf", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const shelf = await created(owner);
  const [inD6, inA6, inB2] = [await savedCopy(owner), await savedCopy(owner), await savedCopy(owner), await savedCopy(owner)];
  await putIn(owner, inD6.id, sectionAt(shelf, 4, 6).id);
  await putIn(owner, inA6.id, sectionAt(shelf, 1, 6).id);
  await putIn(owner, inB2.id, sectionAt(shelf, 2, 2).id);
  expect((await shelfList(owner)).notOnAShelf).toBe(1);

  const { shelf: shrunk, movedToNotOnAShelf } = await edited(owner, shelf.id, { columns: 3, rows: 5 });

  expect(movedToNotOnAShelf).toBe(2);
  expect(grid(shrunk)).toEqual(grid({ ...shelf, sections: shelf.sections.filter((section) => section.column <= 3 && section.row <= 5) }));
  expect(sectionAt(shrunk, 2, 2)).toEqual({ ...sectionAt(shelf, 2, 2), copyCount: 1 });
  expect((await shelfList(owner)).notOnAShelf).toBe(3);

  const { shelf: regrown } = await edited(owner, shelf.id, { columns: 4, rows: 6 });
  expect(sectionAt(regrown, 4, 6).copyCount).toBe(0);
  expect(sectionAt(regrown, 4, 6).id).not.toBe(sectionAt(shelf, 4, 6).id);
});

test("deleting a Shelf removes it and its photo, and moves its Copies to Not on a shelf", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const shelf = await created(owner);
  const kept = await created(owner, { name: "Hall", columns: 2, rows: 2 });
  const [first, second, elsewhere] = [await savedCopy(owner), await savedCopy(owner), await savedCopy(owner)];
  await putIn(owner, first.id, sectionAt(shelf, 1, 1).id);
  await putIn(owner, second.id, sectionAt(shelf, 4, 6).id);
  await putIn(owner, elsewhere.id, sectionAt(kept, 1, 1).id);

  const deleted = await owner.as(`/shelves/${shelf.id}`, { method: "DELETE" });

  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({ movedToNotOnAShelf: 2 });
  expect(await shelfList(owner)).toMatchObject({ shelves: [{ id: kept.id }], notOnAShelf: 2 });
  expect((await owner.as(`/shelves/${shelf.id}`)).status).toBe(404);
  expect((await app.request(shelf.photo.url, { headers: { cookie: owner.session } })).status).toBe(404);
  expect(await storedFiles(app)).toHaveLength(1);
  expect((await owner.as(`/copies/${first.id}`)).status).toBe(200);
  expect((await owner.as(`/shelves/${shelf.id}`, { method: "DELETE" })).status).toBe(404);
});

test("only Members see, change or delete a Collection's Shelves, or put its Copies in them", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  const shelf = await created(owner);
  const copy = await savedCopy(owner);
  const friendsCopy = await savedCopy(friend);
  const asFriend = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { cookie: friend.session, ...init.headers } });
  const intoOwners = (path: string, init: RequestInit = {}) => asFriend(`/api/collections/${owner.collectionId}${path}`, init);

  const responses = [
    await intoOwners("/shelves"),
    await intoOwners(`/shelves/${shelf.id}`),
    await intoOwners("/shelves", { method: "POST", body: form({}) }),
    await intoOwners(`/shelves/${shelf.id}`, { method: "PUT", body: form({ name: "Mine" }) }),
    await intoOwners(`/shelves/${shelf.id}`, { method: "DELETE" }),
    await asFriend(shelf.photo.url),
    await friend.as(`/shelves/${shelf.id}`),
    await edit(friend, shelf.id, { name: "Mine" }),
    await friend.as(`/shelves/${shelf.id}`, { method: "DELETE" }),
    await putIn(friend, friendsCopy.id, sectionAt(shelf, 1, 1).id),
    await putIn(friend, copy.id, null),
    await app.request(shelf.photo.url),
    await app.request(`/api/collections/${owner.collectionId}/shelves`),
  ];

  expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404, 404, 404, 404, 401, 401]);
  expect(await shelfList(owner)).toEqual({ shelves: [shelf], notOnAShelf: 1 });
  expect((await shelfList(friend)).shelves).toEqual([]);
  expect(await storedFiles(app)).toHaveLength(1);
});
