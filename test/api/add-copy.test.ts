import { expect, test } from "vitest";
import { sampleReleases, type FakeRelease } from "../../src/server/fake-discogs.ts";
import { invitedFriend, listCopies, logInWithCollection, saveCopy } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

const kindOfBlue = "886979891211";
const discovery = "190295328709";

test("a barcode that matches one Release shows that Release with cover, artist, title, label, country and year", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const response = await owner.as(`/lookup?barcode=${discovery}`);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    barcode: discovery,
    candidates: [
      {
        discogsReleaseId: 16893476,
        artist: "Daft Punk",
        title: "Discovery",
        label: "Parlophone",
        catalogNumber: "0190295328709",
        country: "Europe",
        pressingYear: 2021,
        format: "Vinyl, 2×LP, Album, Reissue",
        coverImageUrl: "/fake-discogs/covers/16893476.svg",
      },
    ],
  });
});

test("a barcode that matches several Releases lists every pressing in Discogs' order", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const response = await owner.as(`/lookup?barcode=${kindOfBlue}`);

  expect(response.status).toBe(200);
  const { candidates } = (await response.json()) as { candidates: { discogsReleaseId: number; country: string; pressingYear: number }[] };
  expect(candidates.map(({ discogsReleaseId, country, pressingYear }) => ({ discogsReleaseId, country, pressingYear }))).toEqual([
    { discogsReleaseId: 2335811, country: "US", pressingYear: 2010 },
    { discogsReleaseId: 2474032, country: "Europe", pressingYear: 2010 },
    { discogsReleaseId: 7371225, country: "Europe", pressingYear: 2015 },
  ]);
});

test("a typed barcode may contain spaces and dashes", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const response = await owner.as(`/lookup?barcode=${encodeURIComponent(" 1 90295-328709 ")}`);

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ barcode: discovery, candidates: [{ discogsReleaseId: 16893476 }] });
});

test("a barcode Discogs doesn't know finds no Releases, and something that isn't a barcode is refused", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const unknown = await owner.as("/lookup?barcode=4006381333931");
  const notABarcode = await owner.as("/lookup?barcode=kind%20of%20blue");
  const tenDigits = await owner.as("/lookup?barcode=8869798912");

  expect(unknown.status).toBe(200);
  expect(await unknown.json()).toEqual({ barcode: "4006381333931", candidates: [] });
  expect(notABarcode.status).toBe(400);
  expect(await notABarcode.json()).toEqual({ error: "Type all the digits under the barcode: 8, 12, 13 or 14 of them." });
  expect(tenDigits.status).toBe(400);
  expect(app.discogs.requests).toHaveLength(1);
});

test("a 14-digit barcode is looked up like any other", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const response = await owner.as(`/lookup?barcode=0${discovery}`);

  expect(response.status).toBe(200);
  expect(app.discogs.requests).toMatchObject([{ endpoint: "search", barcode: `0${discovery}` }]);
});

test("saving a picked Release creates a Copy with both conditions Very Good Plus, shown in the Collection", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  await owner.as(`/lookup?barcode=${kindOfBlue}`);

  const saved = await saveCopy(owner, 2474032);

  expect(saved.status).toBe(201);
  const { copy } = (await saved.json()) as { copy: unknown };
  expect(copy).toEqual({
    id: expect.any(String),
    mediaCondition: "Very Good Plus (VG+)",
    sleeveCondition: "Very Good Plus (VG+)",
    addedAt: "2026-03-01T12:00:00.000Z",
    value: { mediaCondition: "Very Good Plus (VG+)", value: null, lowestListing: null, currency: "DKK", fetchedAt: "2026-03-01T12:00:00.000Z" },
    release: {
      discogsReleaseId: 2474032,
      artist: "Miles Davis",
      title: "Kind Of Blue",
      label: "Columbia",
      catalogNumber: "88697 98912 1",
      country: "Europe",
      pressingYear: 2010,
      originalYear: 1959,
      coverImageUrl: "/fake-discogs/covers/2474032.svg",
    },
  });
  expect(await listCopies(owner)).toEqual([copy]);
});

test("two Copies of the same Release are two Copies, newest first", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const first = await saveCopy(owner, 16893476);
  app.clock.advance(60_000);
  const second = await saveCopy(owner, 16893476);

  const ids = [((await second.json()) as { copy: { id: string } }).copy.id, ((await first.json()) as { copy: { id: string } }).copy.id];
  expect(ids[0]).not.toBe(ids[1]);
  expect((await listCopies(owner)).map((copy) => (copy as { id: string }).id)).toEqual(ids);
});

test("the Original year comes from the master release, so a reissue keeps the year the music came out", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const saved = await saveCopy(owner, 16893476);

  expect(((await saved.json()) as { copy: { release: unknown } }).copy.release).toMatchObject({ pressingYear: 2021, originalYear: 2001 });
});

test("Discogs is asked once per barcode and once per Release; later Lookups and saves use the cached Release data", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");

  const first = await (await owner.as(`/lookup?barcode=${kindOfBlue}`)).json();
  await saveCopy(owner, 2335811);
  const again = await (await friend.as(`/lookup?barcode=${kindOfBlue}`)).json();
  await saveCopy(friend, 2335811);

  expect(again).toEqual(first);
  const releaseRequests = app.discogs.requests.filter((request) => request.endpoint === "search" || request.endpoint === "release");
  expect(releaseRequests.map(({ token: _, secret: __, ...request }) => request)).toEqual([
    { endpoint: "search", barcode: kindOfBlue },
    { endpoint: "release", discogsReleaseId: 2335811 },
  ]);
});

test("Discogs is asked with the logged-in User's own Discogs token", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");

  await owner.as(`/lookup?barcode=${kindOfBlue}`);
  await friend.as(`/lookup?barcode=${discovery}`);

  const [ownerIdentity, friendIdentity] = app.discogs.issuedIdentities;
  expect(app.discogs.requests.map(({ token, secret }) => ({ token, secret }))).toEqual([
    { token: ownerIdentity!.accessToken, secret: ownerIdentity!.accessSecret },
    { token: friendIdentity!.accessToken, secret: friendIdentity!.accessSecret },
  ]);
});

test("only Members see a Collection's Copies or add to it", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  await saveCopy(owner, 16893476);
  const intoOwners = (path: string, init: RequestInit = {}) =>
    app.request(`/api/collections/${owner.collectionId}${path}`, { ...init, headers: { cookie: friend.session, ...init.headers } });

  const list = await intoOwners("/copies");
  const lookup = await intoOwners(`/lookup?barcode=${discovery}`);
  const save = await intoOwners("/copies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ discogsReleaseId: 16893476 }),
  });
  const notACollection = await friend.as("/../not-a-uuid/copies");

  expect([list.status, lookup.status, save.status]).toEqual([404, 404, 404]);
  expect(notACollection.status).toBe(404);
  expect(await listCopies(friend)).toEqual([]);
  expect(await listCopies(owner)).toHaveLength(1);
});

test("nobody logged in gets 401", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const responses = await Promise.all([
    app.request(`/api/collections/${owner.collectionId}/copies`),
    app.request(`/api/collections/${owner.collectionId}/lookup?barcode=${discovery}`),
    app.request(`/api/collections/${owner.collectionId}/copies`, { method: "POST", body: JSON.stringify({ discogsReleaseId: 16893476 }) }),
  ]);

  expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
});

test("a save with no Discogs release id is refused", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const responses = await Promise.all(
    [{}, { discogsReleaseId: "16893476" }, { discogsReleaseId: -1 }].map((body) =>
      owner.as("/copies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    ),
  );

  expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
  expect(await listCopies(owner)).toEqual([]);
});

test("when Discogs can't be reached the Lookup and the save say so instead of failing silently", async () => {
  const release: FakeRelease = sampleReleases[3]!;
  const app = await createTestApp({ discogs: { releases: [release], unavailable: true } });
  const owner = await logInWithCollection(app);

  const lookup = await owner.as(`/lookup?barcode=${discovery}`);
  const save = await saveCopy(owner, release.discogsReleaseId);

  expect(lookup.status).toBe(502);
  expect(await lookup.json()).toEqual({ error: "Discogs didn't answer. Try again in a moment." });
  expect(save.status).toBe(502);
  expect(await listCopies(owner)).toEqual([]);
});

test("saving a Release id Discogs doesn't have is refused as not found, and no Copy is made", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const save = await saveCopy(owner, 999999999);

  expect(save.status).toBe(404);
  expect(await save.json()).toEqual({ error: "Discogs has no Release 999999999. Look up the barcode again and pick a Release from the list." });
  expect(await listCopies(owner)).toEqual([]);
});
