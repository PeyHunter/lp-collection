import { expect, test } from "vitest";
import type { CopyView } from "../../src/server/collection.ts";
import { priceLadder, type FakeDiscogsScript, type FakeRelease } from "../../src/server/fake-discogs.ts";
import { invitedFriend, logInWithCollection, saveCopy, type Member } from "../support/members.ts";
import { createTestApp } from "../support/test-app.ts";

type ListPage = {
  copies: CopyView[];
  total: number;
  groups: { key: string; total: number; length: number }[];
  next: string | null;
  facets: { periods: { period: number; count: number }[]; genres: { genre: string; count: number }[] } | null;
  sellerSettingsMissing: boolean;
};

function release(discogsReleaseId: number, artist: string, title: string, facts: Partial<FakeRelease>): FakeRelease {
  return {
    discogsReleaseId,
    artist,
    title,
    label: null,
    catalogNumber: null,
    country: null,
    pressingYear: null,
    originalYear: null,
    coverImageUrl: null,
    format: null,
    genres: [],
    styles: [],
    barcodes: [],
    ...facts,
  };
}

const kindOfBlue = release(1, "Miles Davis", "Kind Of Blue", { label: "Columbia", catalogNumber: "CS 8163", originalYear: 1959, pressingYear: 2010, genres: ["Jazz"], styles: ["Modal"] });
const abbeyRoad = release(2, "The Beatles", "Abbey Road", { label: "Apple", catalogNumber: "PCS 7088", originalYear: 1969, pressingYear: 2019, genres: ["Rock"], styles: ["Pop Rock"] });
const transEurope = release(3, "Kraftwerk", "Trans-Europe Express", { label: "Kling Klang", catalogNumber: "1C 064-82 306", originalYear: 1977, pressingYear: 1977, genres: ["Electronic"], styles: ["Synth-pop"] });
const houndsOfLove = release(4, "Kate Bush", "Hounds Of Love", { label: "EMI", catalogNumber: "KAB 1", originalYear: 1985, pressingYear: 1985, genres: ["Electronic", "Rock", "Pop"], styles: ["Art Rock"] });
const gas5 = release(5, "Gasolin'", "Gas 5", { label: "CBS", catalogNumber: "CBS 69209", originalYear: 1975, pressingYear: 1975, genres: ["Rock"], styles: ["Pop Rock"] });
const bitchesBrew = release(6, "Miles Davis", "Bitches Brew", { label: "Columbia", catalogNumber: "GP 26", originalYear: 1970, pressingYear: 1970, genres: ["Jazz"], styles: ["Fusion"] });
const demo = release(7, "Ukendt", "Demo 100%_", {});

const allReleases = [kindOfBlue, abbeyRoad, transEurope, houndsOfLove, gas5, bitchesBrew, demo];

const script: FakeDiscogsScript = {
  releases: allReleases,
  prices: { 1: priceLadder(32), 2: priceLadder(38), 3: priceLadder(110), 5: priceLadder(20), 7: priceLadder(5) },
};

async function collectionOfSeven(discogs: FakeDiscogsScript = { ...script }) {
  const app = await createTestApp({ discogs });
  const owner = await logInWithCollection(app);
  for (const { discogsReleaseId } of allReleases) {
    app.clock.advance(60_000);
    expect((await saveCopy(owner, discogsReleaseId)).status).toBe(201);
  }
  return { app, owner };
}

const readOnly = collectionOfSeven();

async function list(user: Member, params: Record<string, string> = {}) {
  const response = await user.as(`/copies?${new URLSearchParams(params)}`);
  expect(response.status).toBe(200);
  return (await response.json()) as ListPage;
}

const titles = (page: ListPage) => page.copies.map((copy) => copy.release.title);

async function everyPage(user: Member, params: Record<string, string>) {
  const pages: ListPage[] = [];
  let cursor: string | null = null;
  do {
    pages.push(await list(user, cursor ? { ...params, cursor } : params));
    cursor = pages.at(-1)!.next;
  } while (cursor);
  return pages;
}

test("the Collection sorts by Value high first by default, and Copies with no Value come last in either direction", async () => {
  const { owner } = await readOnly;

  const highFirst = await list(owner);
  const lowFirst = await list(owner, { sort: "value", dir: "asc" });

  expect(titles(highFirst)).toEqual(["Trans-Europe Express", "Abbey Road", "Kind Of Blue", "Gas 5", "Demo 100%_", "Hounds Of Love", "Bitches Brew"]);
  expect(titles(lowFirst)).toEqual(["Demo 100%_", "Gas 5", "Kind Of Blue", "Abbey Road", "Trans-Europe Express", "Hounds Of Love", "Bitches Brew"]);
  expect(highFirst.total).toBe(7);
  expect(highFirst.next).toBeNull();
});

test("the Value sort uses the Value the viewer sees: the current Media condition in the viewer's currency", async () => {
  const discogs = { ...script };
  const { app, owner } = await collectionOfSeven(discogs);
  const expensive = (await list(owner)).copies[0]!;
  discogs.unavailable = true;
  await owner.as(`/copies/${expensive.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mediaCondition: "Good (G)" }) });

  expect(titles(await list(owner)).slice(-3)).toEqual(["Hounds Of Love", "Trans-Europe Express", "Bitches Brew"]);

  await app.request("/api/me/currency", { method: "PUT", headers: { cookie: owner.session, "content-type": "application/json" }, body: JSON.stringify({ currency: "EUR" }) });
  const inEuros = await list(owner, { dir: "asc" });
  expect(inEuros.copies.map((copy) => copy.value)).toEqual(Array(7).fill(null));
  expect(titles(inEuros)).toEqual(["Abbey Road", "Gas 5", "Hounds Of Love", "Trans-Europe Express", "Bitches Brew", "Kind Of Blue", "Demo 100%_"]);
});

test("artist sorts A to Z ignoring a leading The, then by Original year, and reverses Z to A", async () => {
  const { owner } = await readOnly;

  expect(titles(await list(owner, { sort: "artist" }))).toEqual(["Abbey Road", "Gas 5", "Hounds Of Love", "Trans-Europe Express", "Kind Of Blue", "Bitches Brew", "Demo 100%_"]);
  expect(titles(await list(owner, { sort: "artist", dir: "desc" }))).toEqual(["Demo 100%_", "Kind Of Blue", "Bitches Brew", "Trans-Europe Express", "Hounds Of Love", "Gas 5", "Abbey Road"]);
});

test("Original year sorts oldest or newest first, with an unknown year last", async () => {
  const { owner } = await readOnly;

  expect(titles(await list(owner, { sort: "year" }))).toEqual(["Kind Of Blue", "Abbey Road", "Bitches Brew", "Gas 5", "Trans-Europe Express", "Hounds Of Love", "Demo 100%_"]);
  expect(titles(await list(owner, { sort: "year", dir: "desc" }))).toEqual(["Hounds Of Love", "Trans-Europe Express", "Gas 5", "Bitches Brew", "Abbey Road", "Kind Of Blue", "Demo 100%_"]);
});

test("Period sorts by the decade of the Original year, artist A to Z inside each Period, and says how many Copies each Period has", async () => {
  const { owner } = await readOnly;

  const page = await list(owner, { sort: "period" });

  expect(titles(page)).toEqual(["Kind Of Blue", "Abbey Road", "Gas 5", "Trans-Europe Express", "Bitches Brew", "Hounds Of Love", "Demo 100%_"]);
  expect(page.groups).toEqual([
    { key: "1950", total: 1, length: 1 },
    { key: "1960", total: 1, length: 1 },
    { key: "1970", total: 3, length: 3 },
    { key: "1980", total: 1, length: 1 },
    { key: "unknown", total: 1, length: 1 },
  ]);
  expect(titles(await list(owner, { sort: "period", dir: "desc" }))).toEqual(["Hounds Of Love", "Gas 5", "Trans-Europe Express", "Bitches Brew", "Abbey Road", "Kind Of Blue", "Demo 100%_"]);
});

test("recently added sorts newest first, or oldest first", async () => {
  const { owner } = await readOnly;

  const newest = titles(await list(owner, { sort: "added" }));

  expect(newest).toEqual(allReleases.map((release) => release.title).reverse());
  expect(titles(await list(owner, { sort: "added", dir: "asc" }))).toEqual(allReleases.map((release) => release.title));
});

test("every Copy carries both its Original year and its Pressing year, and its genres", async () => {
  const { owner } = await readOnly;

  const [abbey] = (await list(owner, { q: "abbey" })).copies;

  expect(abbey!.release).toMatchObject({ originalYear: 1969, pressingYear: 2019, genres: ["Rock"], styles: ["Pop Rock"] });
});

test("one search box matches artist, title, label, Catalog number, genre and style, in any case", async () => {
  const { owner } = await readOnly;
  const search = async (q: string) => titles(await list(owner, { q, sort: "artist" })).sort();

  expect(await search("DAVIS")).toEqual(["Bitches Brew", "Kind Of Blue"]);
  expect(await search("road")).toEqual(["Abbey Road"]);
  expect(await search("kling")).toEqual(["Trans-Europe Express"]);
  expect(await search("CS 8163")).toEqual(["Kind Of Blue"]);
  expect(await search("pcs7088")).toEqual(["Abbey Road"]);
  expect(await search("jazz")).toEqual(["Bitches Brew", "Kind Of Blue"]);
  expect(await search("synth")).toEqual(["Trans-Europe Express"]);
  expect(await search("miles brew")).toEqual(["Bitches Brew"]);
  expect(await search("100%_")).toEqual(["Demo 100%_"]);
  expect(await search("%")).toEqual(["Demo 100%_"]);
  expect(await search("nothing like this")).toEqual([]);
  expect(await search("  ")).toHaveLength(7);
});

test("Period and genre filters combine with each other, with search and with every sort", async () => {
  const { owner } = await readOnly;

  expect(titles(await list(owner, { genre: "Rock", sort: "year", dir: "desc" }))).toEqual(["Hounds Of Love", "Gas 5", "Abbey Road"]);
  expect(titles(await list(owner, { genre: "Rock", period: "1970" }))).toEqual(["Gas 5"]);
  expect(titles(await list(owner, { genre: "Electronic", sort: "value" }))).toEqual(["Trans-Europe Express", "Hounds Of Love"]);
  expect(titles(await list(owner, { period: "1970", q: "miles", sort: "value", dir: "asc" }))).toEqual(["Bitches Brew"]);
  expect(titles(await list(owner, { period: "1970", q: "columbia", genre: "Rock" }))).toEqual([]);
  const filtered = await list(owner, { period: "1970", sort: "artist" });
  expect(titles(filtered)).toEqual(["Gas 5", "Trans-Europe Express", "Bitches Brew"]);
  expect(filtered.total).toBe(3);
});

test("the first page offers the Collection's Periods and genres with how many Copies each has, whatever the search", async () => {
  const { owner } = await readOnly;

  const { facets, next } = await list(owner, { q: "road", genre: "Rock" });
  const { facets: onLaterPages } = await list(owner, { limit: "2", cursor: (await list(owner, { limit: "2" })).next! });

  expect(facets).toEqual({
    periods: [
      { period: 1950, count: 1 },
      { period: 1960, count: 1 },
      { period: 1970, count: 3 },
      { period: 1980, count: 1 },
    ],
    genres: [
      { genre: "Rock", count: 3 },
      { genre: "Electronic", count: 2 },
      { genre: "Jazz", count: 2 },
      { genre: "Pop", count: 1 },
    ],
  });
  expect(next).toBeNull();
  expect(onLaterPages).toBeNull();
});

test("Value groups say how many Copies each band has, with no Value its own group", async () => {
  const { owner } = await readOnly;

  const page = await list(owner);

  expect(page.copies.map((copy) => copy.value?.value ?? null)).toEqual([615.45, 212.61, 179.04, 111.9, 27.98, null, null]);
  expect(page.groups).toEqual([
    { key: "500", total: 1, length: 1 },
    { key: "200", total: 1, length: 1 },
    { key: "100", total: 2, length: 2 },
    { key: "20", total: 1, length: 1 },
    { key: "none", total: 2, length: 2 },
  ]);
});

test("pages follow on from each other with no Copy missing or repeated, for every sort and direction", async () => {
  const { owner } = await readOnly;

  for (const sort of ["value", "artist", "year", "period", "added"]) {
    for (const dir of ["asc", "desc"]) {
      const whole = await list(owner, { sort, dir });
      const pages = await everyPage(owner, { sort, dir, limit: "2" });
      expect(pages.map((page) => page.copies.length)).toEqual([2, 2, 2, 1]);
      expect(pages.flatMap(titles)).toEqual(titles(whole));
      expect(pages.map((page) => page.total)).toEqual([7, 7, 7, 7]);
    }
  }
});

test("a group split across two pages keeps its total on both", async () => {
  const { owner } = await readOnly;

  const [first, second] = await everyPage(owner, { sort: "period", limit: "4" });

  expect(first!.groups.at(-1)).toEqual({ key: "1970", total: 3, length: 2 });
  expect(second!.groups[0]).toEqual({ key: "1970", total: 3, length: 1 });
});

test("a Copy saved while the User scrolls doesn't repeat or push out the Copies after the page they have", async () => {
  const discogs: FakeDiscogsScript = { ...script, releases: [...allReleases, release(8, "Aphex Twin", "Selected Ambient Works", { originalYear: 1992 })], prices: { ...script.prices, 8: priceLadder(500) } };
  const { owner } = await collectionOfSeven(discogs);

  const first = await list(owner, { limit: "3" });
  await saveCopy(owner, 8);
  const second = await list(owner, { limit: "10", cursor: first.next! });

  expect(titles(first)).toEqual(["Trans-Europe Express", "Abbey Road", "Kind Of Blue"]);
  expect(titles(second)).toEqual(["Gas 5", "Demo 100%_", "Hounds Of Love", "Bitches Brew"]);
});

test("a page asks for at most 100 Copies and defaults to 50", async () => {
  const app = await createTestApp({ discogs: { releases: [kindOfBlue] } });
  const owner = await logInWithCollection(app);
  for (let saves = 0; saves < 51; saves++) await saveCopy(owner, kindOfBlue.discogsReleaseId);

  const page = await list(owner);

  expect(page.copies).toHaveLength(50);
  expect(page.total).toBe(51);
  expect((await list(owner, { cursor: page.next! })).copies).toHaveLength(1);
  expect((await list(owner, { limit: "100" })).copies).toHaveLength(51);
});

test("a sort, direction, filter, page size or cursor the app doesn't know is refused", async () => {
  const { owner } = await readOnly;
  const { next } = await list(owner, { limit: "2" });

  const refused: Record<string, string>[] = [
    { sort: "price" },
    { dir: "up" },
    { period: "1975" },
    { period: "seventies" },
    { limit: "0" },
    { limit: "101" },
    { limit: "ten" },
    { q: "x".repeat(201) },
    { genre: "x".repeat(101) },
    { cursor: "not-a-cursor" },
    { cursor: next!, sort: "artist" },
    { cursor: next!, dir: "asc" },
  ];
  for (const params of refused) {
    const response = await owner.as(`/copies?${new URLSearchParams(params)}`);
    expect({ params, status: response.status }).toEqual({ params, status: 400 });
  }
});

test("only Members can search, sort or filter a Collection", async () => {
  const { app, owner } = await collectionOfSeven();
  const friend = await invitedFriend(app, owner.session, "friend");

  const asFriend = await app.request(`/api/collections/${owner.collectionId}/copies?q=davis&sort=artist`, { headers: { cookie: friend.session } });
  const loggedOut = await app.request(`/api/collections/${owner.collectionId}/copies?q=davis`);

  expect([asFriend.status, loggedOut.status]).toEqual([404, 401]);
  expect((await list(friend, { q: "davis" })).copies).toEqual([]);
});

test("a Release saved before genres were kept gets them on the next Value fetch, so genre search and filters find it", async () => {
  const { app, owner } = await collectionOfSeven();
  await app.query("UPDATE releases SET genres = NULL, styles = NULL");

  expect(titles(await list(owner, { q: "jazz" }))).toEqual([]);
  const fetched = await owner.as("/values", { method: "POST" });

  expect(fetched.status).toBe(200);
  const answer = (await fetched.json()) as { more: boolean };
  if (answer.more) await owner.as("/values", { method: "POST" });
  expect(titles(await list(owner, { q: "jazz", sort: "year" }))).toEqual(["Kind Of Blue", "Bitches Brew"]);
  expect(titles(await list(owner, { genre: "Rock", sort: "year" }))).toEqual(["Abbey Road", "Gas 5", "Hounds Of Love"]);
});
