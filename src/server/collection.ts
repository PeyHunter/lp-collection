import { and, asc, count, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppDependencies } from "./app.ts";
import { gainOf, parseCopyChanges, purchaseOf } from "./copy-details.ts";
import type { Condition, DiscogsAuth, LookupQuery, LookupResult, ReleaseCandidate } from "./discogs.ts";
import { createListing, decodeCursor, defaultDirection, latestSnapshot, sortNames, type CachedRelease, type ListedCopy, type ListQuery, type SortName } from "./listing.ts";
import { createPhotoStore, maxPhotoBytes, readJpegSize } from "./photos.ts";
import { uuidPattern, type Member, type MemberEnv } from "./member.ts";
import { barcodeLookupCache, copies, photos, releases } from "./schema.ts";
import { createValuation, type CopyValue, type ValuationOutcome } from "./valuation.ts";

const { searchText: _, artistSortKey: __, ...releaseColumns } = getTableColumns(releases);

const discogsUnreachable = "Discogs didn't answer. Try again in a moment.";
const valueBatchSize = 5;
const failedValueRetryMs = 15 * 60_000;

const maxTypedLength = 100;

function parseBarcode(typed: string) {
  const digits = typed.replaceAll(/[\s-]/g, "");
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits : undefined;
}

function tidy(typed: string | undefined) {
  return (typed ?? "").replaceAll(/\s+/g, " ").trim();
}

function parseLookup(params: Record<string, string>): { query: LookupQuery } | { error: string } {
  const { barcode, catalogNumber, artist, title } = params;
  const ways = [barcode !== undefined, catalogNumber !== undefined, artist !== undefined || title !== undefined].filter(Boolean).length;
  if (ways === 0) return { error: "Say what to look up: a barcode, a Catalog number, or an artist and title." };
  if (ways > 1) return { error: "Look up one thing at a time: a barcode, a Catalog number, or an artist and title." };
  if (barcode !== undefined) {
    const digits = parseBarcode(barcode);
    return digits ? { query: { barcode: digits } } : { error: "Type all the digits under the barcode: 8, 12, 13 or 14 of them." };
  }
  if (catalogNumber !== undefined) {
    const typed = tidy(catalogNumber);
    if (!typed) return { error: "Type the Catalog number from the spine or the label." };
    if (typed.length > maxTypedLength) return { error: `That's longer than any Catalog number. Type at most ${maxTypedLength} characters.` };
    return { query: { catalogNumber: typed } };
  }
  const query = { artist: tidy(artist), title: tidy(title) };
  if (!query.artist && !query.title) return { error: "Type the artist, the title, or both." };
  if (query.artist.length > maxTypedLength || query.title.length > maxTypedLength) {
    return { error: `That's longer than any artist or title. Type at most ${maxTypedLength} characters each.` };
  }
  return { query };
}

type PhotoView = { id: string; url: string; width: number; height: number };

function photoView(collectionId: string, photo: typeof photos.$inferSelect): PhotoView {
  return { id: photo.id, url: `/api/collections/${collectionId}/copies/${photo.copyId}/photos/${photo.id}`, width: photo.width, height: photo.height };
}

function copyView(row: { copy: typeof copies.$inferSelect; release: CachedRelease }, value: CopyValue | undefined, gain: number | null, photos: PhotoView[]) {
  const { fetchedAt: _, genres, styles, ...release } = row.release;
  return {
    id: row.copy.id,
    mediaCondition: row.copy.mediaCondition,
    sleeveCondition: row.copy.sleeveCondition,
    addedAt: row.copy.createdAt.toISOString(),
    note: row.copy.note,
    purchasePrice: purchaseOf(row.copy),
    purchaseDate: row.copy.purchaseDate,
    value: value ?? null,
    gain,
    photos,
    pictureUrl: photos[0]?.url ?? release.coverImageUrl,
    release: { ...release, genres: genres ?? [], styles: styles ?? [] },
  };
}

export type CopyView = ReturnType<typeof copyView>;

const maxSearchLength = 200;
const maxGenreLength = 100;
const defaultPageSize = 50;
const maxPageSize = 100;

function parseListQuery(params: Record<string, string>): ListQuery | undefined {
  const sort = (params.sort ?? "value") as SortName;
  if (!sortNames.includes(sort)) return undefined;
  const direction = params.dir ?? defaultDirection(sort);
  if (direction !== "asc" && direction !== "desc") return undefined;
  const search = (params.q ?? "").trim();
  if (search.length > maxSearchLength) return undefined;
  const period = params.period === undefined ? null : /^\d{3}0$/.test(params.period) ? Number(params.period) : undefined;
  if (period === undefined) return undefined;
  const genre = params.genre ?? null;
  if (genre !== null && (genre.length === 0 || genre.length > maxGenreLength)) return undefined;
  const limit = params.limit === undefined ? defaultPageSize : /^\d{1,3}$/.test(params.limit) ? Number(params.limit) : 0;
  if (limit < 1 || limit > maxPageSize) return undefined;
  const after = params.cursor === undefined ? null : decodeCursor(params.cursor, sort, direction);
  if (after === undefined) return undefined;
  return { search, sort, direction, period, genre, after, limit };
}

function parseValuesRequest(body: unknown, now: Date): { retryEmptyBefore?: Date } {
  const { retryEmpty, retryEmptyBefore } = (body ?? {}) as Record<string, unknown>;
  if (typeof retryEmptyBefore === "string" && !Number.isNaN(Date.parse(retryEmptyBefore))) {
    return { retryEmptyBefore: new Date(Math.min(Date.parse(retryEmptyBefore), now.getTime())) };
  }
  return retryEmpty === true ? { retryEmptyBefore: now } : {};
}

function sellerSettingsMissingAfter(outcome: ValuationOutcome | undefined, before: boolean) {
  return outcome === "valued" ? false : outcome === "seller-settings-missing" ? true : before;
}

export type LookupCandidate = ReleaseCandidate & { copiesInCollection: number };

export type LookupView = LookupQuery & { total: number; candidates: LookupCandidate[] };

export function createCollectionRoutes({ database, discogs, exchangeRates, now, photosDir }: AppDependencies) {
  const { db } = database;
  const photoStore = createPhotoStore(photosDir);
  const valuation = createValuation({ database, discogs, exchangeRates, now });
  const listing = createListing(database);
  const routes = new Hono<MemberEnv>();
  const valueBatches = new Map<string, Promise<{ sellerSettingsMissing: boolean; valued: string[]; more: boolean }>>();
  const failedAt = new Map<string, Date>();

  function waitsAfterFailure(key: string) {
    const failed = failedAt.get(key);
    if (failed && now().getTime() - failed.getTime() < failedValueRetryMs) return true;
    failedAt.delete(key);
    return false;
  }

  async function lookUp(query: LookupQuery, auth: DiscogsAuth): Promise<LookupResult> {
    if (!("barcode" in query)) return discogs.lookup(query, auth);
    const { barcode } = query;
    const [cached] = await db.select().from(barcodeLookupCache).where(eq(barcodeLookupCache.barcode, barcode));
    if (cached) return { candidates: cached.candidates, total: cached.candidates.length };
    const found = await discogs.lookup(query, auth);
    if (found.candidates.length > 0) {
      await db.insert(barcodeLookupCache).values({ barcode, candidates: found.candidates, lookedUpAt: now() }).onConflictDoNothing();
    }
    return found;
  }

  async function copiesInCollection(collectionId: string, discogsReleaseIds: number[]) {
    if (discogsReleaseIds.length === 0) return new Map<number, number>();
    const rows = await db
      .select({ discogsReleaseId: copies.discogsReleaseId, copies: count() })
      .from(copies)
      .where(and(eq(copies.collectionId, collectionId), inArray(copies.discogsReleaseId, discogsReleaseIds)))
      .groupBy(copies.discogsReleaseId);
    return new Map(rows.map((row) => [row.discogsReleaseId, row.copies]));
  }

  async function cacheRelease(discogsReleaseId: number, auth: DiscogsAuth) {
    const [cached] = await db.select({ id: releases.discogsReleaseId }).from(releases).where(eq(releases.discogsReleaseId, discogsReleaseId));
    if (cached) return true;
    const release = await discogs.release(discogsReleaseId, auth);
    if (!release) return false;
    await db
      .insert(releases)
      .values({ ...release, fetchedAt: now() })
      .onConflictDoNothing();
    return true;
  }

  async function photosOf(collectionId: string, copyIds: string[]) {
    const rows = copyIds.length === 0 ? [] : await db.select().from(photos).where(inArray(photos.copyId, copyIds)).orderBy(asc(photos.createdAt), asc(photos.id));
    const byCopy = new Map<string, PhotoView[]>(copyIds.map((copyId) => [copyId, []]));
    for (const photo of rows) byCopy.get(photo.copyId)!.push(photoView(collectionId, photo));
    return byCopy;
  }

  async function views(collectionId: string, rows: ListedCopy[]) {
    const [photosByCopy, gains] = await Promise.all([
      photosOf(collectionId, rows.map((row) => row.copy.id)),
      Promise.all(rows.map((row) => gainOf(row.value, purchaseOf(row.copy), exchangeRates))),
    ]);
    return rows.map((row, index) => copyView(row, row.value, gains[index]!, photosByCopy.get(row.copy.id)!));
  }

  async function oneCopy({ collectionId, currency }: Member, copyId: string) {
    if (!uuidPattern.test(copyId)) return undefined;
    const [row] = await db
      .select({ copy: copies, release: releaseColumns })
      .from(copies)
      .innerJoin(releases, eq(releases.discogsReleaseId, copies.discogsReleaseId))
      .where(and(eq(copies.id, copyId), eq(copies.collectionId, collectionId)));
    if (!row) return undefined;
    const [copy] = await views(collectionId, [{ ...row, value: await valuation.currentValue(copyId, currency) }]);
    return copy;
  }

  routes.get("/api/collections/:collectionId/lookup", async (c) => {
    const parsed = parseLookup(c.req.query());
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const { query } = parsed;
    const { auth, collectionId } = c.var.member;
    let found: LookupResult;
    try {
      found = await lookUp(query, auth);
    } catch (error) {
      console.error(`Discogs Lookup of ${JSON.stringify(query)} failed: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: discogsUnreachable }, 502);
    }
    const owned = await copiesInCollection(
      collectionId,
      found.candidates.map((candidate) => candidate.discogsReleaseId),
    );
    const candidates = found.candidates.map((candidate) => ({ ...candidate, copiesInCollection: owned.get(candidate.discogsReleaseId) ?? 0 }));
    return c.json<LookupView>({ ...query, total: found.total, candidates });
  });

  routes.get("/api/collections/:collectionId/copies", async (c) => {
    const member = c.var.member;
    const query = parseListQuery(c.req.query());
    if (!query) {
      return c.json({ error: "Search with up to 200 characters, sort by value, artist, year, period or added, and filter by a decade such as 1970 or one genre." }, 400);
    }
    const { listed, ...page } = await listing.page(member.collectionId, member.currency, query);
    return c.json({
      copies: await views(member.collectionId, listed),
      ...page,
      sellerSettingsMissing: member.sellerSettingsMissing,
    });
  });

  routes.post("/api/collections/:collectionId/copies", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { discogsReleaseId?: unknown } | undefined;
    const discogsReleaseId = body?.discogsReleaseId;
    if (typeof discogsReleaseId !== "number" || !Number.isSafeInteger(discogsReleaseId) || discogsReleaseId <= 0) {
      return c.json({ error: "Say which Release to save with its Discogs release id." }, 400);
    }
    const member = c.var.member;
    try {
      if (!(await cacheRelease(discogsReleaseId, member.auth))) {
        return c.json({ error: `Discogs has no Release ${discogsReleaseId}. Look up the barcode again and pick a Release from the list.` }, 404);
      }
    } catch (error) {
      console.error(`Discogs Release ${discogsReleaseId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: discogsUnreachable }, 502);
    }
    const [copy] = await db.insert(copies).values({ collectionId: member.collectionId, discogsReleaseId, createdAt: now() }).returning();
    const outcome = await valuation.fetchValue(copy!, member);
    return c.json(
      { copy: await oneCopy(member, copy!.id), sellerSettingsMissing: sellerSettingsMissingAfter(outcome, member.sellerSettingsMissing) },
      201,
    );
  });

  routes.get("/api/collections/:collectionId/copies/:copyId", async (c) => {
    const member = c.var.member;
    const copy = await oneCopy(member, c.req.param("copyId"));
    if (!copy) return c.json({ error: "No such Copy" }, 404);
    return c.json({ copy, sellerSettingsMissing: member.sellerSettingsMissing });
  });

  routes.patch("/api/collections/:collectionId/copies/:copyId", async (c) => {
    const member = c.var.member;
    const copyId = c.req.param("copyId");
    const before = await oneCopy(member, copyId);
    if (!before) return c.json({ error: "No such Copy" }, 404);
    const parsed = parseCopyChanges(await c.req.json().catch(() => undefined), now());
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const { changes } = parsed;
    const [copy] = await db.update(copies).set(changes).where(eq(copies.id, copyId)).returning();
    const conditionChanged = changes.mediaCondition !== undefined || changes.sleeveCondition !== undefined;
    const outcome =
      conditionChanged && (copy!.mediaCondition !== before.mediaCondition || !before.value) ? await valuation.fetchValue(copy!, member) : undefined;
    return c.json({
      copy: await oneCopy(member, copyId),
      sellerSettingsMissing: sellerSettingsMissingAfter(outcome, member.sellerSettingsMissing),
    });
  });

  routes.delete("/api/collections/:collectionId/copies/:copyId", async (c) => {
    const { collectionId } = c.var.member;
    const copyId = c.req.param("copyId");
    if (!uuidPattern.test(copyId)) return c.json({ error: "No such Copy" }, 404);
    const fileKeys = await db.transaction(async (tx) => {
      const [copy] = await tx.select({ id: copies.id }).from(copies).where(and(eq(copies.id, copyId), eq(copies.collectionId, collectionId))).for("update");
      if (!copy) return undefined;
      const removed = await tx.delete(photos).where(eq(photos.copyId, copyId)).returning({ fileKey: photos.fileKey });
      await tx.delete(copies).where(eq(copies.id, copyId));
      return removed.map((photo) => photo.fileKey);
    });
    if (!fileKeys) return c.json({ error: "No such Copy" }, 404);
    await photoStore.remove(fileKeys);
    return c.body(null, 204);
  });

  async function memberPhoto({ collectionId }: Member, copyId: string, photoId: string) {
    if (!uuidPattern.test(copyId) || !uuidPattern.test(photoId)) return undefined;
    const [row] = await db
      .select({ fileKey: photos.fileKey })
      .from(photos)
      .innerJoin(copies, eq(copies.id, photos.copyId))
      .where(and(eq(photos.id, photoId), eq(photos.copyId, copyId), eq(copies.collectionId, collectionId)));
    return row;
  }

  routes.post(
    "/api/collections/:collectionId/copies/:copyId/photos",
    bodyLimit({ maxSize: maxPhotoBytes, onError: (c) => c.json({ error: "That photo is too big. Photos up to 10 MB can be added." }, 413) }),
    async (c) => {
      const member = c.var.member;
      const copyId = c.req.param("copyId");
      if (!(await oneCopy(member, copyId))) return c.json({ error: "No such Copy" }, 404);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const size = readJpegSize(bytes);
      if (size === "not-jpeg") return c.json({ error: "Only JPEG photos can be added. Take or pick a photo in the app." }, 415);
      if (size === "unreadable") return c.json({ error: "That photo couldn't be read. Take or pick it again." }, 400);
      const fileKey = await photoStore.write(bytes);
      try {
        await db.insert(photos).values({ copyId, fileKey, ...size, bytes: bytes.length, createdAt: now() });
      } catch (error) {
        await photoStore.remove([fileKey]);
        throw error;
      }
      return c.json({ copy: await oneCopy(member, copyId) }, 201);
    },
  );

  routes.get("/api/collections/:collectionId/copies/:copyId/photos/:photoId", async (c) => {
    const photo = await memberPhoto(c.var.member, c.req.param("copyId"), c.req.param("photoId"));
    const bytes = photo && (await photoStore.read(photo.fileKey).catch((error: Error) => console.error(`Photo file ${photo.fileKey} is missing: ${error.message}`)));
    if (!bytes) return c.json({ error: "No such photo" }, 404);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
  });

  routes.delete("/api/collections/:collectionId/copies/:copyId/photos/:photoId", async (c) => {
    const member = c.var.member;
    const copyId = c.req.param("copyId");
    const photo = await memberPhoto(member, copyId, c.req.param("photoId"));
    if (!photo) return c.json({ error: "No such photo" }, 404);
    const removed = await db.delete(photos).where(eq(photos.fileKey, photo.fileKey)).returning({ fileKey: photos.fileKey });
    await photoStore.remove(removed.map((each) => each.fileKey));
    return c.json({ copy: await oneCopy(member, copyId) });
  });

  async function copiesWithoutValue({ collectionId, currency }: Member, retryEmptyBefore: Date | undefined) {
    const { rows } = await db.execute<{ id: string; discogs_release_id: number; media_condition: Condition }>(sql`
      select c.id, c.discogs_release_id, c.media_condition
      from copies c
      left join lateral (${latestSnapshot(sql`c`, currency)}) v on true
      where c.collection_id = ${collectionId}
        and (v.fetched_at is null or (v.value is null and v.fetched_at < ${retryEmptyBefore?.toISOString() ?? null}::timestamptz))
      order by c.created_at desc, c.id desc`);
    return rows
      .filter((row) => !waitsAfterFailure(row.id))
      .map((row) => ({ id: row.id, discogsReleaseId: row.discogs_release_id, mediaCondition: row.media_condition }));
  }

  async function fetchMissingValues(member: Member, retryEmptyBefore: Date | undefined) {
    const due = await copiesWithoutValue(member, retryEmptyBefore);
    let sellerSettingsMissing = member.sellerSettingsMissing;
    const valued: string[] = [];
    for (const copy of due.slice(0, valueBatchSize)) {
      const outcome = await valuation.fetchValue(copy, member);
      sellerSettingsMissing = sellerSettingsMissingAfter(outcome, sellerSettingsMissing);
      if (outcome === "seller-settings-missing") return { sellerSettingsMissing, valued, more: false };
      if (outcome === "unavailable") failedAt.set(copy.id, now());
      if (outcome === "valued") valued.push(copy.id);
    }
    return { sellerSettingsMissing, valued, more: valued.length > 0 && due.length > valueBatchSize };
  }

  async function fillInGenres({ collectionId, auth }: Member) {
    const { rows } = await db.execute<{ discogs_release_id: number }>(sql`
      select distinct r.discogs_release_id
      from releases r join copies c on c.discogs_release_id = r.discogs_release_id
      where c.collection_id = ${collectionId} and r.genres is null`);
    const due = rows.map((row) => row.discogs_release_id).filter((id) => !waitsAfterFailure(`release ${id}`));
    let filled = false;
    for (const discogsReleaseId of due.slice(0, valueBatchSize)) {
      try {
        const release = await discogs.release(discogsReleaseId, auth);
        await db
          .update(releases)
          .set({ genres: release?.genres ?? [], styles: release?.styles ?? [] })
          .where(eq(releases.discogsReleaseId, discogsReleaseId));
        filled = true;
      } catch (error) {
        console.error(`Genres of Release ${discogsReleaseId} failed: ${error instanceof Error ? error.message : String(error)}`);
        failedAt.set(`release ${discogsReleaseId}`, now());
      }
    }
    return { more: filled && due.length > valueBatchSize };
  }

  async function fetchMissingDetails(member: Member, retryEmptyBefore: Date | undefined) {
    const values = await fetchMissingValues(member, retryEmptyBefore);
    const genres = await fillInGenres(member);
    return { ...values, more: values.more || genres.more };
  }

  routes.post("/api/collections/:collectionId/values", async (c) => {
    const member = c.var.member;
    const { retryEmptyBefore } = parseValuesRequest(await c.req.json().catch(() => undefined), now());
    const key = [member.userId, member.collectionId, member.currency, retryEmptyBefore?.toISOString()].join(" ");
    let batch = valueBatches.get(key);
    if (!batch) {
      batch = fetchMissingDetails(member, retryEmptyBefore).finally(() => valueBatches.delete(key));
      valueBatches.set(key, batch);
    }
    const { sellerSettingsMissing, valued, more } = await batch;
    const copies: CopyView[] = [];
    for (const copyId of valued) {
      const copy = await oneCopy(member, copyId);
      if (copy) copies.push(copy);
    }
    return c.json({ copies, sellerSettingsMissing, more, retryEmptyBefore: retryEmptyBefore?.toISOString() });
  });

  return routes;
}
