import { and, asc, eq, getTableColumns, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppDependencies } from "./app.ts";
import { gainOf, parseCopyChanges, purchaseOf } from "./copy-details.ts";
import type { Condition, Currency, DiscogsAuth, Money, LookupQuery, LookupResult, ReleaseCandidate, Suggestion } from "./discogs.ts";
import { collectionValue, createListing, decodeCursor, defaultDirection, latestSnapshot, sortNames, type CachedRelease, type ListedCopy, type ListQuery, type SortName } from "./listing.ts";
import { collectionCsv } from "./csv.ts";
import { cacheRelease as cacheReleaseOnce } from "./releases.ts";
import { createPhotoStore, maxPhotoBytes, readJpegSize } from "./photos.ts";
import { uuidPattern, type Member, type MemberEnv } from "./member.ts";
import { barcodeLookupCache, collectionValues, copies, photos, releases, valueSnapshots } from "./schema.ts";
import { isCollectionSection, locationsOf, type CopyLocation } from "./shelves.ts";
import { createValuation, type CopyValue, type ValuationOutcome } from "./valuation.ts";

const { searchText: _, artistSortKey: __, ...releaseColumns } = getTableColumns(releases);

const discogsUnreachable = "Discogs didn't answer. Try again in a moment.";
const valueBatchSize = 5;
const lowestListingRecheckMs = 60 * 60 * 1000;
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
  const { barcode, artist, title } = params;
  const ways = [barcode !== undefined, artist !== undefined || title !== undefined].filter(Boolean).length;
  if (ways === 0) return { error: "Say what to look up: a barcode, or an artist and title." };
  if (ways > 1) return { error: "Look up one thing at a time: a barcode, or an artist and title." };
  if (barcode !== undefined) {
    const digits = parseBarcode(barcode);
    return digits ? { query: { barcode: digits } } : { error: "Type all the digits under the barcode: 8, 12, 13 or 14 of them." };
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

function copyView(row: { copy: typeof copies.$inferSelect; release: CachedRelease }, photos: PhotoView[], location: CopyLocation | null) {
  const { fetchedAt: _, genres, styles, ...release } = row.release;
  return {
    id: row.copy.id,
    mediaCondition: row.copy.mediaCondition,
    sleeveCondition: row.copy.sleeveCondition,
    addedAt: row.copy.createdAt.toISOString(),
    note: row.copy.note,
    location,
    photos,
    pictureUrl: photos[0]?.url ?? release.coverImageUrl,
    release: { ...release, genres: genres ?? [], styles: styles ?? [] },
  };
}

export type ValueHistory = { recordedAt: string; mediaCondition: Condition; value: number | null }[];

/** What a Copy is worth to the Member looking at it. Every answer leaves these out while that Member hides Values. */
export type CopyValues = {
  purchasePrice: Money | null;
  purchaseDate: string | null;
  value: CopyValue | null;
  gain: number | null;
};

export type CopyWithoutValues = ReturnType<typeof copyView>;

export type CopyWithValues = CopyWithoutValues & CopyValues;

export type CopyView = CopyWithoutValues | CopyWithValues;

const maxSearchLength = 200;
const maxGenreLength = 100;
const defaultPageSize = 50;
const maxPageSize = 100;

function listSorts(showValues: boolean): readonly SortName[] {
  return showValues ? sortNames : sortNames.filter((sort) => sort !== "value");
}

function parseListQuery(params: Record<string, string>, showValues: boolean): ListQuery | undefined {
  const sorts = listSorts(showValues);
  const sort = (params.sort ?? sorts[0]) as SortName;
  if (!sorts.includes(sort)) return undefined;
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
  const shelf = params.shelf === undefined ? null : params.shelf === "none" ? "none" : undefined;
  if (shelf === undefined) return undefined;
  const after = params.cursor === undefined ? null : decodeCursor(params.cursor, sort, direction);
  if (after === undefined) return undefined;
  return { search, sort, direction, period, genre, shelf, after, limit };
}

function parseValuesRequest(body: unknown, now: Date): { retryEmptyBefore?: Date } {
  const { retryEmpty, retryEmptyBefore } = (body ?? {}) as Record<string, unknown>;
  if (typeof retryEmptyBefore === "string" && !Number.isNaN(Date.parse(retryEmptyBefore))) {
    return { retryEmptyBefore: new Date(Math.min(Date.parse(retryEmptyBefore), now.getTime())) };
  }
  return retryEmpty === true ? { retryEmptyBefore: now } : {};
}

function sellerSettingsMissingAfter(outcome: ValuationOutcome | undefined, before: boolean) {
  return outcome?.kind === "valued" ? outcome.sellerSettingsMissing : before;
}

export type LookupCandidate = ReleaseCandidate & { copiesInCollection: number; held: { copyId: string; location: CopyLocation | null }[] };

/** An artist and title Lookup that matched nothing carries close spellings Discogs knows. */
export type LookupView = ({ barcode: string } | { artist: string; title: string; suggestions: Suggestion[] }) & { total: number; candidates: LookupCandidate[] };

export function createCollectionRoutes({ database, discogs, exchangeRates, now, photosDir, mirror }: AppDependencies) {
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

  async function suggestionsFor(query: { artist: string; title: string }, auth: DiscogsAuth) {
    try {
      return await discogs.suggest(query, auth);
    } catch (error) {
      console.error(`Discogs suggestions for ${JSON.stringify(query)} failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /** The Copies the Collection already holds of each Release, with where each one lives. */
  async function heldCopies(collectionId: string, discogsReleaseIds: number[]) {
    const rows =
      discogsReleaseIds.length === 0
        ? []
        : await db
            .select({ discogsReleaseId: copies.discogsReleaseId, copyId: copies.id, sectionId: copies.sectionId })
            .from(copies)
            .where(and(eq(copies.collectionId, collectionId), inArray(copies.discogsReleaseId, discogsReleaseIds)))
            .orderBy(asc(copies.createdAt), asc(copies.id));
    const locations = await locationsOf(database, rows.map((row) => row.sectionId));
    const held = new Map<number, LookupCandidate["held"]>();
    for (const row of rows) {
      const list = held.get(row.discogsReleaseId) ?? [];
      list.push({ copyId: row.copyId, location: (row.sectionId && locations.get(row.sectionId)) || null });
      held.set(row.discogsReleaseId, list);
    }
    return held;
  }

  const cacheRelease = (discogsReleaseId: number, auth: DiscogsAuth) => cacheReleaseOnce(database, discogs, now, discogsReleaseId, auth);

  async function photosOf(collectionId: string, copyIds: string[]) {
    const rows = copyIds.length === 0 ? [] : await db.select().from(photos).where(inArray(photos.copyId, copyIds)).orderBy(asc(photos.createdAt), asc(photos.id));
    const byCopy = new Map<string, PhotoView[]>(copyIds.map((copyId) => [copyId, []]));
    for (const photo of rows) byCopy.get(photo.copyId)!.push(photoView(collectionId, photo));
    return byCopy;
  }

  async function views({ collectionId, showValues }: Member, rows: ListedCopy[]): Promise<CopyView[]> {
    const [photosByCopy, locations, gains] = await Promise.all([
      photosOf(collectionId, rows.map((row) => row.copy.id)),
      locationsOf(database, rows.map((row) => row.copy.sectionId)),
      showValues ? Promise.all(rows.map((row) => gainOf(row.value, purchaseOf(row.copy), exchangeRates))) : [],
    ]);
    return rows.map((row, index) => {
      const sectionId = row.copy.sectionId;
      const view = copyView(row, photosByCopy.get(row.copy.id)!, (sectionId && locations.get(sectionId)) || null);
      if (!showValues) return view;
      return { ...view, purchasePrice: purchaseOf(row.copy), purchaseDate: row.copy.purchaseDate, value: row.value ?? null, gain: gains[index]! };
    });
  }

  /** Whether a change to the Copy is still to reach the Owner's Discogs collection. */
  async function syncState(copyId: string) {
    return { notSyncedYet: (await mirror.pending([copyId])).has(copyId) };
  }

  /** The seller settings state is about Values, so it is left out with them. */
  function valuesState({ showValues }: Member, sellerSettingsMissing: boolean) {
    return showValues ? { sellerSettingsMissing } : {};
  }

  /** The Values monthly refreshes recorded for a Copy in the viewer's currency, oldest first. */
  async function valueHistory(copyId: string, currency: Currency): Promise<ValueHistory> {
    const rows = await db
      .select({ fetchedAt: valueSnapshots.fetchedAt, mediaCondition: valueSnapshots.mediaCondition, value: valueSnapshots.value })
      .from(valueSnapshots)
      .where(and(eq(valueSnapshots.copyId, copyId), eq(valueSnapshots.currency, currency), isNotNull(valueSnapshots.refreshId)))
      .orderBy(asc(valueSnapshots.fetchedAt), asc(valueSnapshots.id));
    return rows.map(({ fetchedAt, ...entry }) => ({ recordedAt: fetchedAt.toISOString(), ...entry }));
  }

  async function oneCopy(member: Member, copyId: string) {
    const { collectionId, currency, showValues } = member;
    if (!uuidPattern.test(copyId)) return undefined;
    const [row] = await db
      .select({ copy: copies, release: releaseColumns })
      .from(copies)
      .innerJoin(releases, eq(releases.discogsReleaseId, copies.discogsReleaseId))
      .where(and(eq(copies.id, copyId), eq(copies.collectionId, collectionId)));
    if (!row) return undefined;
    const [copy] = await views(member, [{ ...row, value: showValues ? await valuation.currentValue(copyId, currency) : undefined }]);
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
    const owned = await heldCopies(
      collectionId,
      found.candidates.map((candidate) => candidate.discogsReleaseId),
    );
    const candidates = found.candidates.map((candidate) => {
      const held = owned.get(candidate.discogsReleaseId) ?? [];
      return { ...candidate, copiesInCollection: held.length, held };
    });
    if ("barcode" in query) return c.json<LookupView>({ ...query, total: found.total, candidates });
    return c.json<LookupView>({ ...query, suggestions: candidates.length === 0 ? await suggestionsFor(query, auth) : [], total: found.total, candidates });
  });

  routes.get("/api/collections/:collectionId/copies", async (c) => {
    const member = c.var.member;
    const query = parseListQuery(c.req.query(), member.showValues);
    if (!query) {
      const sorts = listSorts(member.showValues);
      return c.json(
        { error: `Search with up to 200 characters, sort by ${sorts.slice(0, -1).join(", ")} or ${sorts.at(-1)}, filter by a decade such as 1970 or one genre, and use shelf=none for the Copies Not on a shelf.` },
        400,
      );
    }
    const { listed, ...page } = await listing.page(member.collectionId, member.currency, query);
    return c.json({
      copies: await views(member, listed),
      notSyncedYet: [...(await mirror.pending(listed.map((row) => row.copy.id)))],
      ...page,
      ...valuesState(member, member.sellerSettingsMissing),
    });
  });

  /** The home screen's big picture. While the Member hides Values it is only the number of Copies. */
  routes.get("/api/collections/:collectionId/overview", async (c) => {
    const member = c.var.member;
    const { collectionId, currency } = member;
    if (!member.showValues) {
      const { copies: count } = await collectionValue(database, collectionId, currency);
      return c.json({ copies: count });
    }
    const top: ListQuery = { search: "", sort: "value", direction: "desc", period: null, genre: null, shelf: null, after: null, limit: 10 };
    const [total, { listed }, history] = await Promise.all([
      collectionValue(database, collectionId, currency),
      listing.page(collectionId, currency, top),
      db
        .select({ recordedAt: collectionValues.recordedAt, value: collectionValues.value })
        .from(collectionValues)
        .where(and(eq(collectionValues.collectionId, collectionId), eq(collectionValues.currency, currency)))
        .orderBy(asc(collectionValues.recordedAt)),
    ]);
    return c.json({
      copies: total.copies,
      collectionValue: { amount: total.value, currency },
      mostValuable: await views(member, listed.filter((row) => row.value?.value != null)),
      history: history.map((entry) => ({ recordedAt: entry.recordedAt.toISOString(), value: entry.value })),
    });
  });

  routes.get("/api/collections/:collectionId/export.csv", async (c) => {
    const member = c.var.member;
    const everyCopy: CopyView[] = [];
    let after: string[] | null = null;
    do {
      const query: ListQuery = { search: "", sort: "artist", direction: "asc", period: null, genre: null, shelf: null, after, limit: maxPageSize };
      const { listed, next } = await listing.page(member.collectionId, member.currency, query);
      everyCopy.push(...(await views(member, listed)));
      after = next ? decodeCursor(next, "artist", "asc")! : null;
    } while (after);
    const day = now().toISOString().slice(0, 10);
    return c.body(collectionCsv(everyCopy, member.showValues), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lp-collection-${day}.csv"`,
      "cache-control": "private, no-store",
    });
  });

  routes.post("/api/collections/:collectionId/copies", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { discogsReleaseId?: unknown; sectionId?: unknown } | undefined;
    const discogsReleaseId = body?.discogsReleaseId;
    if (typeof discogsReleaseId !== "number" || !Number.isSafeInteger(discogsReleaseId) || discogsReleaseId <= 0) {
      return c.json({ error: "Say which Release to save with its Discogs release id." }, 400);
    }
    const sectionId = body?.sectionId ?? null;
    if (sectionId !== null && (typeof sectionId !== "string" || !uuidPattern.test(sectionId))) return c.json({ error: "Say which Section, or leave it out." }, 400);
    const member = c.var.member;
    if (sectionId !== null && !(await isCollectionSection(database, member.collectionId, sectionId))) return c.json({ error: "No such Section" }, 404);
    try {
      if (!(await cacheRelease(discogsReleaseId, member.auth))) {
        return c.json({ error: `Discogs has no Release ${discogsReleaseId}. Look up the barcode again and pick a Release from the list.` }, 404);
      }
    } catch (error) {
      console.error(`Discogs Release ${discogsReleaseId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: discogsUnreachable }, 502);
    }
    const [copy] = await db.insert(copies).values({ collectionId: member.collectionId, discogsReleaseId, sectionId, createdAt: now() }).returning();
    await mirror.copyAdded(copy!);
    const outcome = member.showValues ? await valuation.fetchValue(copy!, member) : undefined;
    return c.json(
      { copy: await oneCopy(member, copy!.id), ...valuesState(member, sellerSettingsMissingAfter(outcome, member.sellerSettingsMissing)), ...(await syncState(copy!.id)) },
      201,
    );
  });

  routes.get("/api/collections/:collectionId/copies/:copyId", async (c) => {
    const member = c.var.member;
    const copy = await oneCopy(member, c.req.param("copyId"));
    if (!copy) return c.json({ error: "No such Copy" }, 404);
    const history = member.showValues ? { valueHistory: await valueHistory(copy.id, member.currency) } : {};
    return c.json({ copy, ...valuesState(member, member.sellerSettingsMissing), ...history, ...(await syncState(copy.id)) });
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
    if (changes.mediaCondition !== undefined || changes.sleeveCondition !== undefined || changes.note !== undefined) await mirror.copyChanged(copy!);
    const conditionChanged = changes.mediaCondition !== undefined || changes.sleeveCondition !== undefined;
    const valueOutdated = "value" in before && (copy!.mediaCondition !== before.mediaCondition || !before.value);
    const outcome = conditionChanged && valueOutdated ? await valuation.fetchValue(copy!, member) : undefined;
    return c.json({
      copy: await oneCopy(member, copyId),
      ...valuesState(member, sellerSettingsMissingAfter(outcome, member.sellerSettingsMissing)),
      ...(await syncState(copyId)),
    });
  });

  routes.delete("/api/collections/:collectionId/copies/:copyId", async (c) => {
    const { collectionId } = c.var.member;
    const copyId = c.req.param("copyId");
    if (!uuidPattern.test(copyId)) return c.json({ error: "No such Copy" }, 404);
    const deleted = await db.transaction(async (tx) => {
      const [copy] = await tx.select().from(copies).where(and(eq(copies.id, copyId), eq(copies.collectionId, collectionId))).for("update");
      if (!copy) return undefined;
      const removed = await tx.delete(photos).where(eq(photos.copyId, copyId)).returning({ fileKey: photos.fileKey });
      await tx.delete(copies).where(eq(copies.id, copyId));
      return { copy, fileKeys: removed.map((photo) => photo.fileKey) };
    });
    if (!deleted) return c.json({ error: "No such Copy" }, 404);
    await mirror.copyDeleted(deleted.copy);
    await photoStore.remove(deleted.fileKeys);
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

  /**
   * Copies with no Value, and Copies whose Value is the Lowest listing (taken while seller settings were missing) and
   * older than an hour, so they get Discogs' suggestion once the seller settings exist. Those come last.
   */
  async function copiesWithoutValue({ collectionId, currency }: Member, retryEmptyBefore: Date | undefined) {
    const lowestBefore = new Date(now().getTime() - lowestListingRecheckMs);
    const { rows } = await db.execute<{ id: string; discogs_release_id: number; media_condition: Condition; lowest: boolean }>(sql`
      select c.id, c.discogs_release_id, c.media_condition, coalesce(v.value = v.lowest_listing, false) as lowest
      from copies c
      left join lateral (${latestSnapshot(sql`c`, currency)}) v on true
      where c.collection_id = ${collectionId}
        and (v.fetched_at is null
          or (v.value is null and v.fetched_at < ${retryEmptyBefore?.toISOString() ?? null}::timestamptz)
          or (v.value = v.lowest_listing and v.fetched_at < ${lowestBefore.toISOString()}::timestamptz))
      order by coalesce(v.value = v.lowest_listing, false), c.created_at desc, c.id desc`);
    return rows
      .filter((row) => !waitsAfterFailure(row.id))
      .map((row) => ({ id: row.id, discogsReleaseId: row.discogs_release_id, mediaCondition: row.media_condition, lowest: row.lowest }));
  }

  async function fetchMissingValues(member: Member, retryEmptyBefore: Date | undefined) {
    const due = await copiesWithoutValue(member, retryEmptyBefore);
    let sellerSettingsMissing = member.sellerSettingsMissing;
    const valued: string[] = [];
    let done = 0;
    for (const copy of due.slice(0, valueBatchSize)) {
      // While seller settings are missing, one Lowest listing Copy (they come last) asks Discogs whether they exist now.
      if (copy.lowest && sellerSettingsMissing && due[done - 1]?.lowest) break;
      const outcome = await valuation.fetchValue(copy, member);
      sellerSettingsMissing = sellerSettingsMissingAfter(outcome, sellerSettingsMissing);
      if (outcome.kind === "unavailable") failedAt.set(copy.id, now());
      else valued.push(copy.id);
      done += 1;
    }
    const more = due.slice(done).some((copy) => !copy.lowest || !sellerSettingsMissing);
    return { sellerSettingsMissing, valued, more: valued.length > 0 && more };
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
    if (!member.showValues) return c.json(await fillInGenres(member));
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
