import { expect, test } from "vitest";
import { priceLadder, type FakeDiscogsScript, type FakeRelease } from "../../src/server/fake-discogs.ts";
import { mirrorCallsPerMinute } from "../../src/server/mirror.ts";
import { logInWithCollection, saveCopy, type Member } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

const gas5: FakeRelease = {
  discogsReleaseId: 5,
  artist: "Gasolin'",
  title: "Gas 5",
  label: "CBS",
  catalogNumber: "CBS 69209",
  country: "Denmark",
  pressingYear: 1975,
  originalYear: 1975,
  coverImageUrl: null,
  formats: [],
  genres: ["Rock"],
  styles: [],
  barcodes: [],
};

type CopyAnswer = { copy: { id: string }; notSyncedYet: boolean };

async function owned(script: FakeDiscogsScript = {}) {
  const discogs: FakeDiscogsScript = { releases: [gas5], prices: { 5: priceLadder(20) }, ...script };
  const app = await createTestApp({ discogs });
  const owner = await logInWithCollection(app);
  return { app, owner, discogs, collection: () => app.discogs.collectionOf(app.appOwnerDiscogsUsername) };
}

async function save(owner: Member) {
  const response = await saveCopy(owner, 5);
  expect(response.status).toBe(201);
  return (await response.json()) as CopyAnswer;
}

function change(owner: Member, copyId: string, changes: object) {
  return owner.as(`/copies/${copyId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
}

async function notSyncedInList(owner: Member) {
  return ((await (await owner.as("/copies")).json()) as { notSyncedYet: string[] }).notSyncedYet;
}

test("adding a Copy adds its Release to the Owner's Discogs collection with both conditions, and keeps the instance id", async () => {
  const { app, owner, collection } = await owned();

  const { copy } = await save(owner);

  expect(collection()).toEqual([{ discogsReleaseId: 5, folderId: 1, instanceId: 1000, mediaCondition: "Very Good Plus (VG+)", sleeveCondition: "Very Good Plus (VG+)", note: null }]);
  expect(await app.query("select discogs_folder_id, discogs_instance_id from copies where id = $1", [copy.id])).toEqual([{ discogs_folder_id: 1, discogs_instance_id: 1000 }]);
  expect(((await (await owner.as(`/copies/${copy.id}`)).json()) as CopyAnswer).notSyncedYet).toBe(false);
  expect(await notSyncedInList(owner)).toEqual([]);
});

test("changing the conditions or the note updates the Discogs collection item; other details stay in the app", async () => {
  const { app, owner, collection } = await owned();
  const { copy } = await save(owner);

  await change(owner, copy.id, { mediaCondition: "Near Mint (NM or M-)", sleeveCondition: "Generic", note: "Signed by Kim Larsen" });
  const fieldWrites = app.discogs.requests.filter((request) => request.endpoint === "collection-fields").length;
  await change(owner, copy.id, { purchasePrice: { amount: 100, currency: "DKK" } });

  expect(collection()).toEqual([
    { discogsReleaseId: 5, folderId: 1, instanceId: 1000, mediaCondition: "Near Mint (NM or M-)", sleeveCondition: "Generic", note: "Signed by Kim Larsen" },
  ]);
  expect(app.discogs.requests.filter((request) => request.endpoint === "collection-fields")).toHaveLength(fieldWrites);
});

test("deleting a Copy removes its Discogs collection item", async () => {
  const { owner, collection } = await owned();
  const { copy } = await save(owner);
  await save(owner);

  expect((await owner.as(`/copies/${copy.id}`, { method: "DELETE" })).status).toBe(204);

  expect(collection().map((item) => item.instanceId)).toEqual([1001]);
});

test("a change Discogs refuses still happens in the app, shows as not synced yet, and is sent again later", async () => {
  const { app, owner, discogs, collection } = await owned({ collectionUnavailable: true });

  const saved = await save(owner);
  await change(owner, saved.copy.id, { note: "Fra fars hylde" });

  expect(saved.notSyncedYet).toBe(true);
  expect(await notSyncedInList(owner)).toEqual([saved.copy.id]);
  expect(collection()).toEqual([]);

  discogs.collectionUnavailable = false;
  await app.mirror.runDue();
  expect(collection()).toEqual([]);

  app.clock.advance(61_000);
  await app.mirror.runDue();

  expect(collection()).toEqual([{ discogsReleaseId: 5, folderId: 1, instanceId: 1000, mediaCondition: "Very Good Plus (VG+)", sleeveCondition: "Very Good Plus (VG+)", note: "Fra fars hylde" }]);
  expect(await notSyncedInList(owner)).toEqual([]);
});

test("a Copy deleted before it reached Discogs is never sent there", async () => {
  const { app, owner, discogs, collection } = await owned({ collectionUnavailable: true });
  const { copy } = await save(owner);
  await owner.as(`/copies/${copy.id}`, { method: "DELETE" });
  discogs.collectionUnavailable = false;
  const before = app.discogs.requests.length;

  app.clock.advance(61_000);
  await app.mirror.runDue();

  expect(collection()).toEqual([]);
  expect(app.discogs.requests).toHaveLength(before);
});

test(`mirror calls keep to ${mirrorCallsPerMinute} a minute per Owner, and the rest wait their turn`, async () => {
  const { app, owner, collection } = await owned();
  const copyIds: string[] = [];
  for (let index = 0; index < 15; index++) copyIds.push((await save(owner)).copy.id);

  const callsInFirstMinute = app.discogs.requests.filter((request) => request.endpoint.startsWith("collection-")).length;
  expect(callsInFirstMinute).toBeLessThanOrEqual(mirrorCallsPerMinute);
  expect((await notSyncedInList(owner)).length).toBeGreaterThan(0);

  for (let minute = 0; minute < 2; minute++) {
    app.clock.advance(60_001);
    const before = app.discogs.requests.filter((request) => request.endpoint.startsWith("collection-")).length;
    await app.mirror.runDue();
    expect(app.discogs.requests.filter((request) => request.endpoint.startsWith("collection-")).length - before).toBeLessThanOrEqual(mirrorCallsPerMinute);
  }

  expect(collection()).toHaveLength(15);
  expect(collection().every((item) => item.mediaCondition === "Very Good Plus (VG+)")).toBe(true);
  expect(await notSyncedInList(owner)).toEqual([]);
});
