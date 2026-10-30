import { and, asc, count, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppDependencies } from "./app.ts";
import { uuidPattern, type MemberEnv } from "./member.ts";
import { createPhotoStore, maxPhotoBytes, readJpegSize, type PhotoSize } from "./photos.ts";
import { copies, sections, shelves, type ShelfCorners } from "./schema.ts";
import { isConvex, maxGridSide } from "../web/shelf-grid.ts";

const maxNameLength = 60;
const formOverhead = 64 * 1024;
const cornersRefused = "Drag the four dots onto the shelf's outer corners: top left, top right, bottom right, bottom left.";

type ShelfFields = { name: string; columns: number; rows: number; corners: ShelfCorners };
type Photo = { bytes: Uint8Array; size: PhotoSize };
type Refusal = { status: 400 | 415; error: string };
type Shelf = typeof shelves.$inferSelect;

function gridSide(value: unknown) {
  const side = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return side >= 1 && side <= maxGridSide ? side : undefined;
}

function parseCorners(value: unknown): ShelfCorners | undefined {
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : undefined;
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) return undefined;
  const inPhoto = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 1;
  const points = parsed.map((point: { x?: unknown; y?: unknown } | null) => (inPhoto(point?.x) && inPhoto(point?.y) ? { x: point.x, y: point.y } : undefined));
  if (points.some((point) => !point)) return undefined;
  const corners = points as ShelfCorners;
  return isConvex(corners) ? corners : undefined;
}

function parseFields(body: Record<string, unknown>): ShelfFields | Refusal {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > maxNameLength) return { status: 400, error: `Give the Shelf a name of up to ${maxNameLength} letters.` };
  const columns = gridSide(body.columns);
  const rows = gridSide(body.rows);
  if (!columns || !rows) return { status: 400, error: `Say how many columns and rows of squares the Shelf has, from 1 to ${maxGridSide} each.` };
  const corners = parseCorners(body.corners);
  if (!corners) return { status: 400, error: cornersRefused };
  return { name, columns, rows, corners };
}

async function parsePhoto(value: unknown): Promise<Photo | Refusal | undefined> {
  if (!(value instanceof File)) return undefined;
  const bytes = new Uint8Array(await value.arrayBuffer());
  const size = readJpegSize(bytes);
  if (size === "not-jpeg") return { status: 415, error: "Only JPEG photos can be used. Take or pick the photo in the app." };
  if (size === "unreadable") return { status: 400, error: "That photo couldn't be read. Take or pick it again." };
  return { bytes, size };
}

const refused = (value: object): value is Refusal => "error" in value;

export function createShelfRoutes({ database, now, photosDir }: AppDependencies) {
  const { db } = database;
  const photoStore = createPhotoStore(photosDir);
  const routes = new Hono<MemberEnv>();
  const formLimit = bodyLimit({ maxSize: maxPhotoBytes + formOverhead, onError: (c) => c.json({ error: "That photo is too big. Photos up to 10 MB can be used." }, 413) });

  async function shelfViews(collectionId: string, rows: Shelf[]): Promise<ShelfView[]> {
    const ids = rows.map((shelf) => shelf.id);
    const sectionRows =
      ids.length === 0
        ? []
        : await db
            .select({ id: sections.id, shelfId: sections.shelfId, column: sections.column, row: sections.row, copyCount: count(copies.id) })
            .from(sections)
            .leftJoin(copies, eq(copies.sectionId, sections.id))
            .where(inArray(sections.shelfId, ids))
            .groupBy(sections.id)
            .orderBy(asc(sections.row), asc(sections.column));
    return rows.map((shelf) => ({
      id: shelf.id,
      name: shelf.name,
      columns: shelf.columns,
      rows: shelf.rows,
      corners: shelf.corners,
      photo: { url: `/api/collections/${collectionId}/shelves/${shelf.id}/photo/${shelf.photoFileKey}`, width: shelf.photoWidth, height: shelf.photoHeight },
      sections: sectionRows.filter((section) => section.shelfId === shelf.id).map(({ shelfId: _, ...section }) => section),
    }));
  }

  async function oneShelf(collectionId: string, shelfId: string) {
    if (!uuidPattern.test(shelfId)) return undefined;
    const [shelf] = await db
      .select()
      .from(shelves)
      .where(and(eq(shelves.id, shelfId), eq(shelves.collectionId, collectionId)));
    return shelf && (await shelfViews(collectionId, [shelf]))[0];
  }

  /** Writes the photo file first and deletes it again unless `save` stores a row that points at it. */
  async function withPhotoFile<T>(photo: Photo | undefined, save: (fileKey: string | undefined) => Promise<T | undefined>) {
    const fileKey = photo && (await photoStore.write(photo.bytes));
    const saved = await save(fileKey).catch(async (error: unknown) => {
      if (fileKey) await photoStore.remove([fileKey]);
      throw error;
    });
    if (!saved && fileKey) await photoStore.remove([fileKey]);
    return saved;
  }

  routes.get("/api/collections/:collectionId/shelves", async (c) => {
    const { collectionId } = c.var.member;
    const [rows, [loose]] = await Promise.all([
      db.select().from(shelves).where(eq(shelves.collectionId, collectionId)).orderBy(asc(shelves.createdAt), asc(shelves.id)),
      db
        .select({ count: count() })
        .from(copies)
        .where(and(eq(copies.collectionId, collectionId), isNull(copies.sectionId))),
    ]);
    return c.json({ shelves: await shelfViews(collectionId, rows), notOnAShelf: loose!.count });
  });

  routes.post("/api/collections/:collectionId/shelves", formLimit, async (c) => {
    const { collectionId } = c.var.member;
    const body: Record<string, unknown> = await c.req.parseBody().catch(() => ({}));
    const fields = parseFields(body);
    if (refused(fields)) return c.json({ error: fields.error }, fields.status);
    const photo = await parsePhoto(body.photo);
    if (!photo) return c.json({ error: "Take or pick a photo of the Shelf." }, 400);
    if (refused(photo)) return c.json({ error: photo.error }, photo.status);
    const shelfId = await withPhotoFile(photo, (fileKey) =>
      db.transaction(async (tx) => {
        const [shelf] = await tx
          .insert(shelves)
          .values({ collectionId, ...fields, photoFileKey: fileKey!, photoWidth: photo.size.width, photoHeight: photo.size.height, createdAt: now() })
          .returning({ id: shelves.id });
        await tx.insert(sections).values(cells(shelf!.id, fields.columns, fields.rows));
        return shelf!.id;
      }),
    );
    return c.json({ shelf: await oneShelf(collectionId, shelfId!) }, 201);
  });

  routes.get("/api/collections/:collectionId/shelves/:shelfId", async (c) => {
    const shelf = await oneShelf(c.var.member.collectionId, c.req.param("shelfId"));
    return shelf ? c.json({ shelf }) : c.json({ error: "No such Shelf" }, 404);
  });

  routes.put("/api/collections/:collectionId/shelves/:shelfId", formLimit, async (c) => {
    const { collectionId } = c.var.member;
    const shelfId = c.req.param("shelfId");
    if (!(await oneShelf(collectionId, shelfId))) return c.json({ error: "No such Shelf" }, 404);
    const body: Record<string, unknown> = await c.req.parseBody().catch(() => ({}));
    const fields = parseFields(body);
    if (refused(fields)) return c.json({ error: fields.error }, fields.status);
    const photo = await parsePhoto(body.photo);
    if (photo && refused(photo)) return c.json({ error: photo.error }, photo.status);

    const outcome = await withPhotoFile(photo, (fileKey) =>
      db.transaction(async (tx) => {
        const [before] = await tx
          .select({ photoFileKey: shelves.photoFileKey })
          .from(shelves)
          .where(and(eq(shelves.id, shelfId), eq(shelves.collectionId, collectionId)))
          .for("update");
        if (!before) return undefined;
        const newPhoto = fileKey && photo ? { photoFileKey: fileKey, photoWidth: photo.size.width, photoHeight: photo.size.height } : {};
        await tx
          .update(shelves)
          .set({ ...fields, ...newPhoto })
          .where(eq(shelves.id, shelfId));
        const outside = or(gt(sections.column, fields.columns), gt(sections.row, fields.rows));
        const [moved] = await tx
          .select({ count: count() })
          .from(copies)
          .innerJoin(sections, eq(sections.id, copies.sectionId))
          .where(and(eq(sections.shelfId, shelfId), outside));
        await tx.delete(sections).where(and(eq(sections.shelfId, shelfId), outside));
        await tx.insert(sections).values(cells(shelfId, fields.columns, fields.rows)).onConflictDoNothing();
        return { movedToNotOnAShelf: moved!.count, replacedFileKey: fileKey ? before.photoFileKey : undefined };
      }),
    );
    if (!outcome) return c.json({ error: "No such Shelf" }, 404);
    if (outcome.replacedFileKey) await photoStore.remove([outcome.replacedFileKey]);
    return c.json({ shelf: await oneShelf(collectionId, shelfId), movedToNotOnAShelf: outcome.movedToNotOnAShelf });
  });

  routes.delete("/api/collections/:collectionId/shelves/:shelfId", async (c) => {
    const { collectionId } = c.var.member;
    const shelfId = c.req.param("shelfId");
    if (!uuidPattern.test(shelfId)) return c.json({ error: "No such Shelf" }, 404);
    const outcome = await db.transaction(async (tx) => {
      const [shelf] = await tx
        .select({ photoFileKey: shelves.photoFileKey })
        .from(shelves)
        .where(and(eq(shelves.id, shelfId), eq(shelves.collectionId, collectionId)))
        .for("update");
      if (!shelf) return undefined;
      const [moved] = await tx
        .select({ count: count() })
        .from(copies)
        .innerJoin(sections, eq(sections.id, copies.sectionId))
        .where(eq(sections.shelfId, shelfId));
      await tx.delete(shelves).where(eq(shelves.id, shelfId));
      return { movedToNotOnAShelf: moved!.count, fileKey: shelf.photoFileKey };
    });
    if (!outcome) return c.json({ error: "No such Shelf" }, 404);
    await photoStore.remove([outcome.fileKey]);
    return c.json({ movedToNotOnAShelf: outcome.movedToNotOnAShelf });
  });

  routes.get("/api/collections/:collectionId/shelves/:shelfId/photo/:fileKey", async (c) => {
    const shelfId = c.req.param("shelfId");
    const fileKey = c.req.param("fileKey");
    const [shelf] = uuidPattern.test(shelfId)
      ? await db
          .select({ id: shelves.id })
          .from(shelves)
          .where(and(eq(shelves.id, shelfId), eq(shelves.collectionId, c.var.member.collectionId), eq(shelves.photoFileKey, fileKey)))
      : [];
    const bytes = shelf && (await photoStore.read(fileKey).catch((error: Error) => console.error(`Shelf photo file ${fileKey} is missing: ${error.message}`)));
    if (!bytes) return c.json({ error: "No such photo" }, 404);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    });
  });

  routes.put("/api/collections/:collectionId/copies/:copyId/section", async (c) => {
    const { collectionId } = c.var.member;
    const copyId = c.req.param("copyId");
    const { sectionId } = ((await c.req.json().catch(() => undefined)) ?? {}) as { sectionId?: unknown };
    if (sectionId !== null && (typeof sectionId !== "string" || !uuidPattern.test(sectionId))) return c.json({ error: "Say which Section, or null for Not on a shelf." }, 400);
    if (sectionId !== null) {
      const [section] = await db
        .select({ id: sections.id })
        .from(sections)
        .innerJoin(shelves, eq(shelves.id, sections.shelfId))
        .where(and(eq(sections.id, sectionId), eq(shelves.collectionId, collectionId)));
      if (!section) return c.json({ error: "No such Section" }, 404);
    }
    if (!uuidPattern.test(copyId)) return c.json({ error: "No such Copy" }, 404);
    const updated = await db
      .update(copies)
      .set({ sectionId })
      .where(and(eq(copies.id, copyId), eq(copies.collectionId, collectionId)))
      .returning({ id: copies.id });
    return updated.length > 0 ? c.body(null, 204) : c.json({ error: "No such Copy" }, 404);
  });

  return routes;
}

function cells(shelfId: string, columns: number, rows: number) {
  return Array.from({ length: columns * rows }, (_, index) => ({ shelfId, column: (index % columns) + 1, row: Math.floor(index / columns) + 1 }));
}

export type ShelfView = {
  id: string;
  name: string;
  columns: number;
  rows: number;
  corners: ShelfCorners;
  photo: { url: string; width: number; height: number };
  sections: { id: string; column: number; row: number; copyCount: number }[];
};
