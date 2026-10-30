import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { sessionUser } from "./access.ts";
import type { AppDependencies } from "./app.ts";
import { gainOf, parseCopyChanges, purchaseOf } from "./copy-details.ts";
import type { DiscogsAuth, LookupQuery, LookupResult, ReleaseCandidate } from "./discogs.ts";
import type { SecretBox } from "./secret-box.ts";
import { createPhotoStore, maxPhotoBytes, readJpegSize } from "./photos.ts";
import { barcodeLookupCache, copies, memberships, photos, releases, users } from "./schema.ts";
import { createValuation, type CopyValue, type ValuationOutcome, type Valuer } from "./valuation.ts";

type Member = Valuer & { collectionId: string; sellerSettingsMissing: boolean };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

function discogsAuth(user: typeof users.$inferSelect, box: SecretBox): DiscogsAuth {
  return { token: box.open(user.discogsAccessToken), secret: box.open(user.discogsAccessSecret) };
}

type PhotoView = { id: string; url: string; width: number; height: number };

function photoView(collectionId: string, photo: typeof photos.$inferSelect): PhotoView {
  return { id: photo.id, url: `/api/collections/${collectionId}/copies/${photo.copyId}/photos/${photo.id}`, width: photo.width, height: photo.height };
}

type CopyRow = { copy: typeof copies.$inferSelect; release: typeof releases.$inferSelect };

function copyView(row: CopyRow, value: CopyValue | undefined, gain: number | null, photos: PhotoView[]) {
  const { fetchedAt: _, ...release } = row.release;
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
    release,
  };
}

export type CopyView = ReturnType<typeof copyView>;

function parseValuesRequest(body: unknown, now: Date): { retryEmptyBefore?: Date } {
  const { retryEmpty, retryEmptyBefore } = (body ?? {}) as Record<string, unknown>;
  if (typeof retryEmptyBefore === "string" && !Number.isNaN(Date.parse(retryEmptyBefore))) {
    return { retryEmptyBefore: new Date(Math.min(Date.parse(retryEmptyBefore), now.getTime())) };
  }
  return retryEmpty === true ? { retryEmptyBefore: now } : {};
}

function needsValue(copy: CopyView, retryEmptyBefore: Date | undefined) {
  return !copy.value || (retryEmptyBefore !== undefined && copy.value.value === null && new Date(copy.value.fetchedAt) < retryEmptyBefore);
}

function sellerSettingsMissingAfter(outcome: ValuationOutcome | undefined, before: boolean) {
  return outcome === "valued" ? false : outcome === "seller-settings-missing" ? true : before;
}

export type LookupCandidate = ReleaseCandidate & { copiesInCollection: number };

export type LookupView = LookupQuery & { total: number; candidates: LookupCandidate[] };

export function createCollectionRoutes({ database, discogs, exchangeRates, secretBox, now, photosDir }: AppDependencies) {
  const { db } = database;
  const photoStore = createPhotoStore(photosDir);
  const valuation = createValuation({ database, discogs, exchangeRates, now });
  const routes = new Hono<{ Variables: { member: Member } }>();
  const valueBatches = new Map<string, Promise<{ sellerSettingsMissing: boolean; more: boolean }>>();
  const failedAt = new Map<string, Date>();

  function waitsAfterFailure(copyId: string) {
    const failed = failedAt.get(copyId);
    if (failed && now().getTime() - failed.getTime() < failedValueRetryMs) return true;
    failedAt.delete(copyId);
    return false;
  }

  routes.use("/api/collections/:collectionId/*", async (c, next) => {
    const user = await sessionUser(database, now, c);
    if (!user) return c.json({ error: "Not logged in" }, 401);
    const collectionId = c.req.param("collectionId");
    const [membership] = uuidPattern.test(collectionId)
      ? await db
          .select()
          .from(memberships)
          .where(and(eq(memberships.collectionId, collectionId), eq(memberships.userId, user.id)))
      : [];
    if (!membership) return c.json({ error: "No such Collection" }, 404);
    c.set("member", {
      userId: user.id,
      currency: user.currency,
      sellerSettingsMissing: user.sellerSettingsMissing,
      auth: discogsAuth(user, secretBox),
      collectionId,
    });
    await next();
  });

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

  async function views(collectionId: string, rows: CopyRow[], values: Map<string, CopyValue>) {
    const ids = rows.map((row) => row.copy.id);
    const [photosByCopy, gains] = await Promise.all([
      photosOf(collectionId, ids),
      Promise.all(rows.map((row) => gainOf(values.get(row.copy.id), purchaseOf(row.copy), exchangeRates))),
    ]);
    return rows.map((row, index) => copyView(row, values.get(row.copy.id), gains[index]!, photosByCopy.get(row.copy.id)!));
  }

  async function collectionCopies({ collectionId, currency }: Member) {
    const [rows, values] = await Promise.all([
      db
        .select({ copy: copies, release: releases })
        .from(copies)
        .innerJoin(releases, eq(releases.discogsReleaseId, copies.discogsReleaseId))
        .where(eq(copies.collectionId, collectionId))
        .orderBy(desc(copies.createdAt), desc(copies.id)),
      valuation.currentValues({ collectionId }, currency),
    ]);
    return views(collectionId, rows, values);
  }

  async function oneCopy({ collectionId, currency }: Member, copyId: string) {
    if (!uuidPattern.test(copyId)) return undefined;
    const [row] = await db
      .select({ copy: copies, release: releases })
      .from(copies)
      .innerJoin(releases, eq(releases.discogsReleaseId, copies.discogsReleaseId))
      .where(and(eq(copies.id, copyId), eq(copies.collectionId, collectionId)));
    if (!row) return undefined;
    const [copy] = await views(collectionId, [row], await valuation.currentValues({ copyId }, currency));
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
    return c.json({ copies: await collectionCopies(member), sellerSettingsMissing: member.sellerSettingsMissing });
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

  async function fetchMissingValues(member: Member, retryEmptyBefore: Date | undefined) {
    const due = (await collectionCopies(member)).filter((copy) => needsValue(copy, retryEmptyBefore) && !waitsAfterFailure(copy.id));
    let sellerSettingsMissing = member.sellerSettingsMissing;
    let valued = false;
    for (const copy of due.slice(0, valueBatchSize)) {
      const outcome = await valuation.fetchValue({ ...copy, discogsReleaseId: copy.release.discogsReleaseId }, member);
      sellerSettingsMissing = sellerSettingsMissingAfter(outcome, sellerSettingsMissing);
      if (outcome === "seller-settings-missing") return { sellerSettingsMissing, more: false };
      if (outcome === "unavailable") failedAt.set(copy.id, now());
      valued ||= outcome === "valued";
    }
    return { sellerSettingsMissing, more: valued && due.length > valueBatchSize };
  }

  routes.post("/api/collections/:collectionId/values", async (c) => {
    const member = c.var.member;
    const { retryEmptyBefore } = parseValuesRequest(await c.req.json().catch(() => undefined), now());
    const key = [member.userId, member.collectionId, member.currency, retryEmptyBefore?.toISOString()].join(" ");
    let batch = valueBatches.get(key);
    if (!batch) {
      batch = fetchMissingValues(member, retryEmptyBefore).finally(() => valueBatches.delete(key));
      valueBatches.set(key, batch);
    }
    const { sellerSettingsMissing, more } = await batch;
    return c.json({ copies: await collectionCopies(member), sellerSettingsMissing, more, retryEmptyBefore: retryEmptyBefore?.toISOString() });
  });

  return routes;
}
