import { expect, test } from "vitest";
import { createFakeCoverReader, maxCoverBytes } from "../../src/server/cover-reader.ts";
import { sampleReleases } from "../../src/server/fake-discogs.ts";
import { createTestApp } from "../support/test-app.ts";

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const sgtPepper = sampleReleases.find((release) => release.discogsReleaseId === 1095979)!;
const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function logIn(app: TestApp) {
  const { session } = await app.logIn(app.appOwnerDiscogsUsername);
  const me = await app.request("/api/me", { headers: { cookie: session! } });
  const body = (await me.json()) as { collection: { id: string }; coverReading: boolean };
  const as = (path: string, init: RequestInit = {}) => app.request(`/api/collections/${body.collection.id}${path}`, { ...init, headers: { cookie: session!, ...init.headers } });
  return { coverReading: body.coverReading, as };
}

const readCover = (as: Awaited<ReturnType<typeof logIn>>["as"], body: BodyInit, type = "image/jpeg") =>
  as("/cover-reading", { method: "POST", headers: { "content-type": type }, body });

test("a photo of a cover is read as an artist and title, and the Lookup with them finds the Release", async () => {
  const reader = createFakeCoverReader({ artist: ` ${sgtPepper.artist} `, title: sgtPepper.title, confidence: "high" });
  const app = await createTestApp({ discogs: { releases: sampleReleases }, coverReader: reader });
  const member = await logIn(app);
  expect(member.coverReading).toBe(true);

  const read = await readCover(member.as, photo);
  expect(read.status).toBe(200);
  const reading = (await read.json()) as { artist: string; title: string; confidence: string };
  expect(reading).toEqual({ artist: "The Beatles", title: "Sgt. Pepper's Lonely Hearts Club Band", confidence: "high" });

  const lookup = await member.as(`/lookup?${new URLSearchParams({ artist: reading.artist, title: reading.title })}`);
  const { candidates } = (await lookup.json()) as { candidates: { discogsReleaseId: number }[] };
  expect(candidates.map((candidate) => candidate.discogsReleaseId)).toContain(1095979);
});

test("without a cover reader the route doesn't exist and the app is told to hide the button", async () => {
  const app = await createTestApp({ discogs: { releases: sampleReleases } });
  const member = await logIn(app);
  expect(member.coverReading).toBe(false);
  expect((await readCover(member.as, photo)).status).toBe(404);
});

test("only images up to 8 MB are read, and only by Members", async () => {
  const reader = createFakeCoverReader({ artist: "a", title: "b", confidence: "low" });
  const app = await createTestApp({ discogs: { releases: sampleReleases }, coverReader: reader });
  const member = await logIn(app);

  expect((await readCover(member.as, "hello", "text/plain")).status).toBe(415);
  expect((await readCover(member.as, "<svg/>", "image/svg+xml")).status).toBe(415);
  expect((await readCover(member.as, new Uint8Array(0))).status).toBe(400);
  expect((await readCover(member.as, new Uint8Array(maxCoverBytes + 1))).status).toBe(413);
  expect((await readCover(member.as, photo, "image/png")).status).toBe(200);
  const stranger = await app.request("/api/collections/00000000-0000-0000-0000-000000000000/cover-reading", { method: "POST", headers: { "content-type": "image/jpeg" }, body: photo });
  expect(stranger.status).toBe(401);
  expect(reader.reads).toBe(1);
});

test("a User reads at most 30 covers in 15 minutes", async () => {
  const reader = createFakeCoverReader({ artist: "a", title: "b", confidence: "low" });
  const app = await createTestApp({ discogs: { releases: sampleReleases }, coverReader: reader });
  const member = await logIn(app);
  for (let read = 0; read < 30; read++) expect((await readCover(member.as, photo)).status).toBe(200);
  expect((await readCover(member.as, photo)).status).toBe(429);
  app.clock.advance(15 * 60 * 1000);
  expect((await readCover(member.as, photo)).status).toBe(200);
});
