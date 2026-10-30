import { readdir, readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import type { CopyView } from "../../src/server/collection.ts";
import { sampleReleases } from "../../src/server/fake-discogs.ts";
import { invitedFriend, listCopies, logInWithCollection, saveCopy, type Member, type TestApp } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

const photo = await readFile(new URL("../fixtures/photo.jpg", import.meta.url));
const discovery = 16893476;

async function savedCopy(user: Member) {
  const response = await saveCopy(user, discovery);
  expect(response.status).toBe(201);
  return ((await response.json()) as { copy: CopyView }).copy;
}

function upload(user: Member, copyId: string, body: BodyInit, contentType = "image/jpeg") {
  return user.as(`/copies/${copyId}/photos`, { method: "POST", headers: { "content-type": contentType }, body });
}

async function uploaded(user: Member, copyId: string) {
  const response = await upload(user, copyId, photo);
  expect(response.status).toBe(201);
  return ((await response.json()) as { copy: CopyView }).copy;
}

async function copyPage(user: Member, copyId: string) {
  const response = await user.as(`/copies/${copyId}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { copy: CopyView }).copy;
}

const storedFiles = (app: TestApp) => readdir(app.photosDir);

test("a Copy without photos shows the Discogs cover", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const copy = await savedCopy(owner);

  expect(copy.photos).toEqual([]);
  expect(copy.pictureUrl).toBe("/fake-discogs/covers/16893476.svg");
  expect(await listCopies(owner)).toMatchObject([{ pictureUrl: "/fake-discogs/covers/16893476.svg" }]);
});

test("an uploaded photo is stored, served back to Members, and shown instead of the cover", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const { id } = await savedCopy(owner);

  const copy = await uploaded(owner, id);

  expect(copy.photos).toEqual([{ id: expect.any(String), url: `/api/collections/${owner.collectionId}/copies/${id}/photos/${copy.photos[0]!.id}`, width: 64, height: 48 }]);
  expect(copy.pictureUrl).toBe(copy.photos[0]!.url);
  expect(await copyPage(owner, id)).toEqual(copy);
  expect(await listCopies(owner)).toMatchObject([{ pictureUrl: copy.photos[0]!.url }]);

  const served = await app.request(copy.photos[0]!.url, { headers: { cookie: owner.session } });
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toBe("image/jpeg");
  expect(served.headers.get("cache-control")).toMatch(/^private\b/);
  expect(Buffer.from(await served.arrayBuffer()).equals(photo)).toBe(true);
});

test("photos keep the order they were added in, and the first one is the Copy's picture", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const { id } = await savedCopy(owner);

  const first = (await uploaded(owner, id)).photos[0]!;
  app.clock.advance(60_000);
  const second = (await uploaded(owner, id)).photos[1]!;
  app.clock.advance(60_000);
  const copy = await uploaded(owner, id);

  expect(copy.photos.map((each) => each.id).slice(0, 2)).toEqual([first.id, second.id]);
  expect(copy.photos).toHaveLength(3);
  expect(copy.pictureUrl).toBe(first.url);
});

test("a stored photo file is named by a random id, never by anything the uploader sent", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const { id } = await savedCopy(owner);

  const response = await owner.as(`/copies/${id}/photos`, {
    method: "POST",
    headers: { "content-type": "image/jpeg", "content-disposition": 'attachment; filename="../../evil.jpg"' },
    body: photo,
  });

  expect(response.status).toBe(201);
  const files = await storedFiles(app);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[0-9a-f]{32}\.jpg$/);
});

test("deleting a photo removes it and its file, and the cover comes back", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const { id } = await savedCopy(owner);
  const { photos } = await uploaded(owner, id);

  const deleted = await owner.as(`/copies/${id}/photos/${photos[0]!.id}`, { method: "DELETE" });

  expect(deleted.status).toBe(200);
  const { copy } = (await deleted.json()) as { copy: CopyView };
  expect(copy.photos).toEqual([]);
  expect(copy.pictureUrl).toBe("/fake-discogs/covers/16893476.svg");
  expect((await app.request(photos[0]!.url, { headers: { cookie: owner.session } })).status).toBe(404);
  expect(await storedFiles(app)).toEqual([]);
  expect((await owner.as(`/copies/${id}/photos/${photos[0]!.id}`, { method: "DELETE" })).status).toBe(404);
});

test("deleting a Copy removes it from the Collection with its photos and their files", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const kept = await savedCopy(owner);
  const keptPhoto = (await uploaded(owner, kept.id)).photos[0]!;
  const { id } = await savedCopy(owner);
  await uploaded(owner, id);
  const { photos } = await uploaded(owner, id);

  const deleted = await owner.as(`/copies/${id}`, { method: "DELETE" });

  expect(deleted.status).toBe(204);
  expect(await listCopies(owner)).toMatchObject([{ id: kept.id }]);
  expect((await owner.as(`/copies/${id}`)).status).toBe(404);
  expect((await app.request(photos[1]!.url, { headers: { cookie: owner.session } })).status).toBe(404);
  expect(await storedFiles(app)).toHaveLength(1);
  expect((await app.request(keptPhoto.url, { headers: { cookie: owner.session } })).status).toBe(200);
  expect((await owner.as(`/copies/${id}`, { method: "DELETE" })).status).toBe(404);
});

test("only Members fetch, add or delete a Collection's photos, or delete its Copies", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  const { id } = await savedCopy(owner);
  const { photos } = await uploaded(owner, id);
  const asFriend = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { cookie: friend.session, ...init.headers } });
  const intoOwners = (path: string, init: RequestInit = {}) => asFriend(`/api/collections/${owner.collectionId}${path}`, init);

  const responses = [
    await asFriend(photos[0]!.url),
    await intoOwners(`/copies/${id}/photos`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: photo }),
    await intoOwners(`/copies/${id}/photos/${photos[0]!.id}`, { method: "DELETE" }),
    await intoOwners(`/copies/${id}`, { method: "DELETE" }),
    await friend.as(`/copies/${id}/photos/${photos[0]!.id}`),
    await upload(friend, id, photo),
    await friend.as(`/copies/${id}`, { method: "DELETE" }),
    await app.request(photos[0]!.url),
  ];

  expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 401]);
  expect((await copyPage(owner, id)).photos).toEqual(photos);
  expect(await storedFiles(app)).toHaveLength(1);
});

test("a photo of another Copy can't be fetched or deleted through this Copy", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const first = await savedCopy(owner);
  const second = await savedCopy(owner);
  const { photos } = await uploaded(owner, first.id);

  const fetched = await owner.as(`/copies/${second.id}/photos/${photos[0]!.id}`);
  const deleted = await owner.as(`/copies/${second.id}/photos/${photos[0]!.id}`, { method: "DELETE" });

  expect([fetched.status, deleted.status]).toEqual([404, 404]);
  expect((await copyPage(owner, first.id)).photos).toEqual(photos);
});

test("anything but a whole JPEG under the size cap is refused and stores nothing", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const { id } = await savedCopy(owner);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
  const oversized = Buffer.concat([photo.subarray(0, photo.length - 2), Buffer.alloc(11 * 1024 * 1024), photo.subarray(-2)]);

  const responses = [
    await upload(owner, id, png, "image/png"),
    await upload(owner, id, png, "image/jpeg"),
    await upload(owner, id, new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/jpeg"),
    await upload(owner, id, photo.subarray(0, photo.length / 2)),
    await upload(owner, id, new Uint8Array()),
    await upload(owner, id, oversized),
  ];

  expect(responses.map((response) => response.status)).toEqual([415, 415, 415, 400, 415, 413]);
  expect(await responses[3]!.json()).toEqual({ error: "That photo couldn't be read. Take or pick it again." });
  expect((await copyPage(owner, id)).photos).toEqual([]);
  expect(await storedFiles(app)).toEqual([]);
});

test("a photo for a Copy that doesn't exist is refused", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const responses = [
    await upload(owner, "00000000-0000-4000-8000-000000000000", photo),
    await upload(owner, "not-a-copy", photo),
    await owner.as("/copies/00000000-0000-4000-8000-000000000000/photos/00000000-0000-4000-8000-000000000000"),
  ];

  expect(responses.map((response) => response.status)).toEqual([404, 404, 404]);
  expect(await storedFiles(app)).toEqual([]);
});
