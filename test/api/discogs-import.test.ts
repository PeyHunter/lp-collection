import { expect, test } from "vitest";
import { createImporter, importPauseMs } from "../../src/server/discogs-import.ts";
import { priceLadder, sampleReleases, type FakeDiscogsScript } from "../../src/server/fake-discogs.ts";
import { logInWithCollection, saveCopy, type Member, type TestApp } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

type Listed = { copies: { id: string; mediaCondition: string; sleeveCondition: string; release: { discogsReleaseId: number; title: string } }[]; total: number };

const releaseIds = sampleReleases.map((release) => release.discogsReleaseId);

async function me(app: TestApp, user: Member) {
  return (await (await app.request("/api/me", { headers: { cookie: user.session } })).json()) as { discogsImport: unknown };
}

async function list(user: Member) {
  return (await (await user.as("/copies?limit=100")).json()) as Listed;
}

const discogsRequests = (app: TestApp, endpoint: string) => app.discogs.requests.filter((request) => request.endpoint === endpoint);

test("a first login with an empty Discogs collection imports nothing and says the import is done", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  expect(await me(app, owner)).toMatchObject({ discogsImport: { status: "done", imported: 0, total: 0 } });
  expect((await list(owner)).total).toBe(0);
});

test("a first login imports every item of a paged Discogs collection, Very Good Plus, keeping each instance id", async () => {
  const owned = Array.from({ length: 230 }, (_, index) => releaseIds[index % releaseIds.length]!);
  const app = await createTestApp({ discogs: { releases: sampleReleases, collections: { "app-owner": owned } } });
  const owner = await logInWithCollection(app);

  expect(await me(app, owner)).toMatchObject({ discogsImport: { status: "done", imported: 230, total: 230 } });
  expect(discogsRequests(app, "collection-page").map((request) => "page" in request && request.page)).toEqual([1, 2, 3]);
  const { copies, total } = await list(owner);
  expect(total).toBe(230);
  expect(copies.every((copy) => copy.mediaCondition === "Very Good Plus (VG+)" && copy.sleeveCondition === "Very Good Plus (VG+)")).toBe(true);
  const instances = await app.query<{ discogs_instance_id: number }>("select discogs_instance_id from copies order by discogs_instance_id");
  expect(instances.map((row) => row.discogs_instance_id)).toEqual(app.discogs.collectionOf("app-owner").map((item) => item.instanceId));
  expect(discogsRequests(app, "release")).toHaveLength(new Set(owned).size);
});

test("logging in again does not import again", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases, collections: { "app-owner": releaseIds.slice(0, 3) } } });
  await logInWithCollection(app);
  const pagesBefore = discogsRequests(app, "collection-page").length;

  const again = await logInWithCollection(app);

  expect(discogsRequests(app, "collection-page")).toHaveLength(pagesBefore);
  expect((await list(again)).total).toBe(3);
});

test("imported Copies are never added to Discogs again; changing one updates its own Discogs item", async () => {
  const discogs: FakeDiscogsScript = { releases: sampleReleases, prices: { [releaseIds[0]!]: priceLadder(30) }, collections: { "app-owner": [releaseIds[0]!] } };
  const app = await createTestApp({ discogs });
  const owner = await logInWithCollection(app);
  const [copy] = (await list(owner)).copies;

  await owner.as(`/copies/${copy!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "Fra Discogs" }) });

  expect(discogsRequests(app, "collection-add")).toHaveLength(0);
  expect(app.discogs.collectionOf("app-owner")).toMatchObject([{ discogsReleaseId: releaseIds[0], note: "Fra Discogs" }]);
});

test("an import Discogs interrupts carries on from the page it stopped at, without importing anything twice", async () => {
  const discogs: FakeDiscogsScript = { releases: sampleReleases, collections: { "app-owner": Array.from({ length: 150 }, (_, index) => releaseIds[index % releaseIds.length]!) } };
  const app = await createTestApp({ discogs });
  const listed = app.discogs.collectionPage.bind(app.discogs);
  let pages = 0;
  app.discogs.collectionPage = async (...args) => {
    if (++pages === 2) throw new Error("Discogs went away");
    return listed(...args);
  };
  const owner = await logInWithCollection(app);
  expect(await me(app, owner)).toMatchObject({ discogsImport: { status: "running", imported: 100, total: 150 } });

  app.clock.advance(61_000);
  await app.importer.runDue();

  expect(await me(app, owner)).toMatchObject({ discogsImport: { status: "done", imported: 150, total: 150 } });
  expect((await list(owner)).total).toBe(150);
});

test("the import keeps to 40 Discogs requests a minute, pausing before each, and a Release fetch counts as two", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases, collections: { "app-owner": releaseIds.slice(0, 4) } } });
  const owner = await logInWithCollection(app);
  await app.query("delete from copies");
  await app.query("delete from releases");
  await app.query("update discogs_imports set status = 'running', next_page = 1, imported = 0");
  const waits: number[] = [];
  const importer = createImporter({ database: app.database, discogs: app.discogs, secretBox: app.secretBox, now: app.now, wait: async (ms) => void waits.push(ms) });

  await importer.runDue();

  expect(importPauseMs).toBe(1500);
  expect(waits).toEqual(Array(1 + 4 * 2).fill(importPauseMs));
  expect((await list(owner)).total).toBe(4);
});
