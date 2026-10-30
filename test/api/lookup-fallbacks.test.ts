import { expect, test } from "vitest";
import { lookupPageSize } from "../../src/server/discogs.ts";
import { sampleReleases, type FakeRelease } from "../../src/server/fake-discogs.ts";
import { createTestApp } from "../support/test-app.ts";

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type Member = Awaited<ReturnType<typeof logInWithCollection>>;
type LookupBody = { total: number; candidates: { discogsReleaseId: number; title: string; copiesInCollection: number }[] };

const noSuchBarcode = "4006381333931";
const sgtPepperUk = 1095979;
const sgtPepperGermany = 3482901;

async function logInWithCollection(app: TestApp, discogsUsername = app.appOwnerDiscogsUsername, invite?: string) {
  const { session } = await app.logIn(discogsUsername, { invite });
  expect(session).toBeDefined();
  const me = await app.request("/api/me", { headers: { cookie: session! } });
  const { collection } = (await me.json()) as { collection: { id: string } };
  const as = (path: string, init: RequestInit = {}) =>
    app.request(`/api/collections/${collection.id}${path}`, { ...init, headers: { cookie: session!, ...init.headers } });
  return { session: session!, collectionId: collection.id, as };
}

async function invitedFriend(app: TestApp, ownerSession: string, discogsUsername: string) {
  const created = await app.request("/api/invites", { method: "POST", headers: { cookie: ownerSession } });
  const { url } = (await created.json()) as { url: string };
  return logInWithCollection(app, discogsUsername, url.split("/invite/")[1]);
}

async function lookUp(user: Member, query: Record<string, string>) {
  const response = await user.as(`/lookup?${new URLSearchParams(query)}`);
  expect(response.status).toBe(200);
  return (await response.json()) as LookupBody & Record<string, unknown>;
}

async function saveCopy(user: Member, discogsReleaseId: number) {
  const response = await user.as("/copies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ discogsReleaseId }),
  });
  expect(response.status).toBe(201);
}

function searches(app: TestApp) {
  return app.discogs.requests.filter((request) => request.endpoint === "search").map(({ token: _, secret: __, ...request }) => request);
}

test("a barcode Discogs doesn't know finds nothing, and the Catalog number from the label finds the Release", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const byBarcode = await lookUp(owner, { barcode: noSuchBarcode });
  const byCatalogNumber = await lookUp(owner, { catalogNumber: " pcs  7027 " });

  expect(byBarcode).toEqual({ barcode: noSuchBarcode, total: 0, candidates: [] });
  expect(byCatalogNumber).toEqual({
    catalogNumber: "pcs 7027",
    total: 1,
    candidates: [
      {
        discogsReleaseId: sgtPepperUk,
        artist: "The Beatles",
        title: "Sgt. Pepper's Lonely Hearts Club Band",
        label: "Parlophone",
        catalogNumber: "PCS 7027",
        country: "UK",
        pressingYear: 1967,
        format: "Vinyl, LP, Album, Stereo",
        coverImageUrl: `/fake-discogs/covers/${sgtPepperUk}.svg`,
        copiesInCollection: 0,
      },
    ],
  });
  expect(searches(app)).toEqual([
    { endpoint: "search", barcode: noSuchBarcode },
    { endpoint: "search", catalogNumber: "pcs 7027" },
  ]);
});

test("a Catalog number Discogs doesn't know finds nothing, and the artist and title find every pressing", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const byCatalogNumber = await lookUp(owner, { catalogNumber: "PCS 9999" });
  const byArtistAndTitle = await lookUp(owner, { artist: "beatles", title: "sgt. pepper" });

  expect(byCatalogNumber).toEqual({ catalogNumber: "PCS 9999", total: 0, candidates: [] });
  expect(byArtistAndTitle).toMatchObject({ artist: "beatles", title: "sgt. pepper", total: 2 });
  expect(byArtistAndTitle.candidates.map(({ discogsReleaseId }) => discogsReleaseId)).toEqual([sgtPepperUk, sgtPepperGermany]);
});

test("the artist alone or the title alone is enough", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const byArtist = await lookUp(owner, { artist: "Gasolin'" });
  const byTitle = await lookUp(owner, { title: "discovery" });

  expect(byArtist).toMatchObject({ artist: "Gasolin'", title: "", candidates: [{ title: "Gas 5" }] });
  expect(byTitle).toMatchObject({ artist: "", title: "discovery", candidates: [{ artist: "Daft Punk" }] });
});

test("an artist and title Discogs doesn't know find nothing", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const body = await lookUp(owner, { artist: "Nobody Anyone Knows", title: "Unheard" });

  expect(body).toEqual({ artist: "Nobody Anyone Knows", title: "Unheard", total: 0, candidates: [] });
});

test("each candidate says how many Copies of it the Collection already has: 1, then 2", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const counts = async () =>
    (await lookUp(owner, { artist: "The Beatles", title: "Sgt. Pepper" })).candidates.map(({ discogsReleaseId, copiesInCollection }) => ({
      discogsReleaseId,
      copiesInCollection,
    }));

  await saveCopy(owner, sgtPepperUk);
  const afterOne = await counts();
  await saveCopy(owner, sgtPepperUk);
  const afterTwo = await counts();

  expect(afterOne).toEqual([
    { discogsReleaseId: sgtPepperUk, copiesInCollection: 1 },
    { discogsReleaseId: sgtPepperGermany, copiesInCollection: 0 },
  ]);
  expect(afterTwo).toEqual([
    { discogsReleaseId: sgtPepperUk, copiesInCollection: 2 },
    { discogsReleaseId: sgtPepperGermany, copiesInCollection: 0 },
  ]);
});

test("the Copy count also shows on a cached barcode Lookup, and counts only the Copies in this Collection", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  const discovery = "190295328709";

  await lookUp(owner, { barcode: discovery });
  await saveCopy(friend, 16893476);
  const ownersView = await lookUp(owner, { barcode: discovery });
  const friendsView = await lookUp(friend, { barcode: discovery });

  expect(ownersView.candidates).toMatchObject([{ discogsReleaseId: 16893476, copiesInCollection: 0 }]);
  expect(friendsView.candidates).toMatchObject([{ discogsReleaseId: 16893476, copiesInCollection: 1 }]);
  expect(searches(app)).toEqual([{ endpoint: "search", barcode: discovery }]);
});

test("only Members can look up into a Collection, by any of the three ways", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);
  const friend = await invitedFriend(app, owner.session, "friend");
  const intoOwners = (query: string) => app.request(`/api/collections/${owner.collectionId}/lookup?${query}`, { headers: { cookie: friend.session } });

  const responses = await Promise.all([
    intoOwners("catalogNumber=PCS%207027"),
    intoOwners("artist=The%20Beatles&title=Sgt"),
    app.request(`/api/collections/${owner.collectionId}/lookup?catalogNumber=PCS%207027`),
  ]);

  expect(responses.map((response) => response.status)).toEqual([404, 404, 401]);
  expect(searches(app)).toEqual([]);
});

test("a broad search shows only the first page of Releases and says how many matched in all", async () => {
  const many: FakeRelease[] = Array.from({ length: lookupPageSize + 5 }, (_, index) => ({
    discogsReleaseId: 500000 + index,
    artist: "The Fall",
    title: `Live ${index + 1}`,
    label: "Cog Sinister",
    catalogNumber: `COG ${index + 1}`,
    country: "UK",
    pressingYear: 1990,
    originalYear: 1990,
    format: "Vinyl, LP",
    coverImageUrl: null,
    genres: ["Rock"],
    styles: ["Post-Punk"],
    barcodes: [],
  }));
  const app = await createTestApp({ discogs: { releases: many } });
  const owner = await logInWithCollection(app);

  const body = await lookUp(owner, { artist: "The Fall" });

  expect(body.total).toBe(lookupPageSize + 5);
  expect(body.candidates).toHaveLength(lookupPageSize);
  expect(body.candidates[0]).toMatchObject({ title: "Live 1" });
});

test("a Lookup needs exactly one way: a barcode, a Catalog number, or an artist and title", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const owner = await logInWithCollection(app);

  const refusals = await Promise.all(
    ["", "catalogNumber=%20%20", "artist=&title=%20", "barcode=190295328709&catalogNumber=PCS%207027", `catalogNumber=${"X".repeat(101)}`].map(
      async (query) => {
        const response = await owner.as(`/lookup?${query}`);
        return { status: response.status, ...((await response.json()) as { error: string }) };
      },
    ),
  );

  expect(refusals).toEqual([
    { status: 400, error: "Say what to look up: a barcode, a Catalog number, or an artist and title." },
    { status: 400, error: "Type the Catalog number from the spine or the label." },
    { status: 400, error: "Type the artist, the title, or both." },
    { status: 400, error: "Look up one thing at a time: a barcode, a Catalog number, or an artist and title." },
    { status: 400, error: "That's longer than any Catalog number. Type at most 100 characters." },
  ]);
  expect(searches(app)).toEqual([]);
});

test("when Discogs can't be reached a Catalog number or artist and title Lookup says so", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases, unavailable: true } });
  const owner = await logInWithCollection(app);

  const responses = await Promise.all([owner.as("/lookup?catalogNumber=PCS%207027"), owner.as("/lookup?artist=The%20Beatles")]);

  expect(responses.map((response) => response.status)).toEqual([502, 502]);
  expect(await responses[0]!.json()).toEqual({ error: "Discogs didn't answer. Try again in a moment." });
});
