import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, inject, onTestFinished, test } from "vitest";
import { keepDays, pruneBackups, restoreBackup, writeBackup } from "../../src/server/backup.ts";
import { priceLadder, sampleReleases } from "../../src/server/fake-discogs.ts";
import { invitedFriend, logInWithCollection, saveCopy, type Member, type TestApp } from "../support/members.ts";
import { createTestApp, days } from "../support/test-app.ts";

const photo = await readFile(new URL("../fixtures/photo.jpg", import.meta.url));
const token = "backup-token-for-tests";
/** A restored database needs the key its Discogs tokens were sealed with, as in production. */
const tokenEncryptionKey = randomBytes(32);

async function scratch() {
  const dir = await mkdtemp(join(inject("scratchDir"), "backup-"));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function fetchPhoto(app: TestApp) {
  return async (fileKey: string) => {
    const response = await app.request(`/internal/backup/photos/${fileKey}`, { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    return new Uint8Array(await response.arrayBuffer());
  };
}

async function filledCollection() {
  const app = await createTestApp({ discogs: { releases: sampleReleases, prices: { 2474032: priceLadder(30) } }, backupToken: token, tokenEncryptionKey });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  const { copy } = (await (await saveCopy(owner, 2474032)).json()) as { copy: { id: string } };
  await saveCopy(owner, 16893476);
  await owner.as(`/copies/${copy.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "Fra fars hylde 'æøå'", purchasePrice: { amount: 100, currency: "DKK" } }) });
  expect((await owner.as(`/copies/${copy.id}/photos`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: photo })).status).toBe(201);
  return { app, owner, friend, copyId: copy.id };
}

const view = async (user: Member) => (await (await user.as("/copies?limit=100")).json()) as { copies: { photos: { url: string }[] }[] };

test("a backup restored into an empty database gives back every User, Copy, Photo and login as they were", async () => {
  const { app, owner, friend, copyId } = await filledCollection();
  const dir = await scratch();

  const backup = await writeBackup({ database: app.database, dir, now: app.now, fetchPhoto: fetchPhoto(app) });
  expect(backup).toMatchObject({ file: join(dir, "db", "2026-03-01.jsonl.gz"), photos: { kept: 1, fetched: 1 } });

  const empty = await createTestApp({ discogs: { releases: sampleReleases }, tokenEncryptionKey });
  const restored = await restoreBackup({ database: empty.database, file: backup.file, photosFrom: join(dir, "photos"), photosDir: empty.photosDir });
  expect(restored).toMatchObject({ photos: 1, rows: { copies: 2, photos: 1, memberships: 2, users: 2 } });

  const asOwnerThere = { ...owner, as: (path: string, init: RequestInit = {}) => empty.request(`/api/collections/${owner.collectionId}${path}`, { ...init, headers: { cookie: owner.session, ...init.headers } }) };
  const before = await view(owner);
  const after = await view(asOwnerThere);
  expect(after).toEqual(before);
  const served = await empty.request(before.copies.find((each) => each.photos.length)!.photos[0]!.url, { headers: { cookie: owner.session } });
  expect(Buffer.from(await served.arrayBuffer()).equals(photo)).toBe(true);
  expect((await empty.request(`/api/collections/${friend.collectionId}/copies`, { headers: { cookie: friend.session } })).status).toBe(200);
  expect((await empty.request(`/api/collections/${owner.collectionId}/copies/${copyId}`, { headers: { cookie: owner.session } })).status).toBe(200);

  const saved = await saveCopy(asOwnerThere, 2474032);
  expect(saved.status).toBe(201);
});

test("restoring refuses a database that already holds anything", async () => {
  const { app } = await filledCollection();
  const dir = await scratch();
  const backup = await writeBackup({ database: app.database, dir, now: app.now, fetchPhoto: fetchPhoto(app) });

  await expect(restoreBackup({ database: app.database, file: backup.file, photosFrom: join(dir, "photos"), photosDir: app.photosDir })).rejects.toThrow(/already holds .*Restore only into an empty database/);
});

test("a Photo already backed up isn't fetched again, and nights older than 30 days go, with the Photos only they named", async () => {
  const { app, owner, copyId } = await filledCollection();
  const dir = await scratch();
  await writeBackup({ database: app.database, dir, now: app.now, fetchPhoto: fetchPhoto(app) });
  const [firstPhoto] = await readdir(join(dir, "photos"));
  const photoId = ((await (await owner.as(`/copies/${copyId}`)).json()) as { copy: { photos: { id: string }[] } }).copy.photos[0]!.id;
  await owner.as(`/copies/${copyId}/photos/${photoId}`, { method: "DELETE" });
  await owner.as(`/copies/${copyId}/photos`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: photo });

  app.clock.advance(days(1));
  expect((await writeBackup({ database: app.database, dir, now: app.now, fetchPhoto: fetchPhoto(app) })).photos).toEqual({ kept: 1, fetched: 1 });
  app.clock.advance(days(keepDays));
  expect((await writeBackup({ database: app.database, dir, now: app.now, fetchPhoto: fetchPhoto(app) })).photos).toEqual({ kept: 1, fetched: 0 });

  const pruned = await pruneBackups(dir, app.now);

  expect(pruned).toEqual({ nightsRemoved: ["2026-03-01"], photosRemoved: 1 });
  expect((await readdir(join(dir, "db"))).sort()).toEqual(["2026-03-02.jsonl.gz", "2026-03-02.photos.json", "2026-04-01.jsonl.gz", "2026-04-01.photos.json"]);
  expect(await readdir(join(dir, "photos"))).not.toContain(firstPhoto);
});

test("the backup's Photo route needs the token and refuses anything that came through the Cloudflare tunnel", async () => {
  const { app } = await filledCollection();
  const fileKey = (await app.query<{ file_key: string }>("select file_key from photos"))[0]!.file_key;
  const url = `/internal/backup/photos/${fileKey}`;

  expect((await app.request(url)).status).toBe(401);
  expect((await app.request(url, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
  expect((await app.request(url, { headers: { authorization: `Bearer ${token}`, "cf-connecting-ip": "203.0.113.9" } })).status).toBe(403);
  expect((await app.request("/internal/backup/photos/..%2F..%2Fetc", { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  expect((await app.request(url, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);

  const withoutToken = await createTestApp();
  expect((await withoutToken.request(url, { headers: { authorization: "Bearer " } })).status).toBe(404);
});

test("a backup that can't fetch its Photos leaves no night behind", async () => {
  const { app } = await filledCollection();
  const dir = await scratch();

  await expect(
    writeBackup({
      database: app.database,
      dir,
      now: app.now,
      fetchPhoto: async () => {
        throw new Error("The app answered with HTTP 401");
      },
    }),
  ).rejects.toThrow("HTTP 401");

  expect((await readdir(join(dir, "db"))).filter((name) => name.endsWith(".jsonl.gz"))).toEqual([]);
});

test("without a Photos directory the restore loads the database and says which Photos still need copying", async () => {
  const { app } = await filledCollection();
  const dir = await scratch();
  const backup = await writeBackup({ database: app.database, dir, now: app.now, fetchPhoto: fetchPhoto(app) });
  const empty = await createTestApp({ tokenEncryptionKey });

  const restored = await restoreBackup({ database: empty.database, file: backup.file, photosFrom: join(dir, "photos") });

  expect(restored.photos).toBe(0);
  expect(restored.photosToCopy).toEqual(await empty.query<{ file_key: string }>("select file_key from photos").then((rows) => rows.map((row) => row.file_key)));
  expect(restored.photosToCopy).toHaveLength(1);
});
