import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { sessionUser } from "./access.ts";
import type { AppDependencies } from "./app.ts";
import type { DiscogsAuth, ReleaseCandidate } from "./discogs.ts";
import type { SecretBox } from "./secret-box.ts";
import { barcodeLookupCache, copies, memberships, releases, users } from "./schema.ts";

type Member = { auth: DiscogsAuth; collectionId: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const discogsUnreachable = "Discogs didn't answer. Try again in a moment.";

function parseBarcode(typed: string | undefined) {
  const digits = (typed ?? "").replaceAll(/[\s-]/g, "");
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits : undefined;
}

function discogsAuth(user: typeof users.$inferSelect, box: SecretBox): DiscogsAuth {
  return { token: box.open(user.discogsAccessToken), secret: box.open(user.discogsAccessSecret) };
}

function copyView(row: { copy: typeof copies.$inferSelect; release: typeof releases.$inferSelect }) {
  const { fetchedAt: _, ...release } = row.release;
  return {
    id: row.copy.id,
    mediaCondition: row.copy.mediaCondition,
    sleeveCondition: row.copy.sleeveCondition,
    addedAt: row.copy.createdAt.toISOString(),
    release,
  };
}

export type CopyView = ReturnType<typeof copyView>;

export function createCollectionRoutes({ database, discogs, secretBox, now }: AppDependencies) {
  const { db } = database;
  const routes = new Hono<{ Variables: { member: Member } }>();

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
    c.set("member", { auth: discogsAuth(user, secretBox), collectionId });
    await next();
  });

  async function lookUpBarcode(barcode: string, auth: DiscogsAuth): Promise<ReleaseCandidate[]> {
    const [cached] = await db.select().from(barcodeLookupCache).where(eq(barcodeLookupCache.barcode, barcode));
    if (cached) return cached.candidates;
    const candidates = await discogs.lookupByBarcode(barcode, auth);
    if (candidates.length > 0) {
      await db.insert(barcodeLookupCache).values({ barcode, candidates, lookedUpAt: now() }).onConflictDoNothing();
    }
    return candidates;
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

  routes.get("/api/collections/:collectionId/lookup", async (c) => {
    const barcode = parseBarcode(c.req.query("barcode"));
    if (!barcode) return c.json({ error: "Type all the digits under the barcode: 8, 12, 13 or 14 of them." }, 400);
    try {
      return c.json({ barcode, candidates: await lookUpBarcode(barcode, c.var.member.auth) });
    } catch (error) {
      console.error(`Discogs Lookup of barcode ${barcode} failed: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: discogsUnreachable }, 502);
    }
  });

  routes.get("/api/collections/:collectionId/copies", async (c) => {
    const rows = await db
      .select({ copy: copies, release: releases })
      .from(copies)
      .innerJoin(releases, eq(releases.discogsReleaseId, copies.discogsReleaseId))
      .where(eq(copies.collectionId, c.var.member.collectionId))
      .orderBy(desc(copies.createdAt), desc(copies.id));
    return c.json({ copies: rows.map(copyView) });
  });

  routes.post("/api/collections/:collectionId/copies", async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { discogsReleaseId?: unknown } | undefined;
    const discogsReleaseId = body?.discogsReleaseId;
    if (typeof discogsReleaseId !== "number" || !Number.isSafeInteger(discogsReleaseId) || discogsReleaseId <= 0) {
      return c.json({ error: "Say which Release to save with its Discogs release id." }, 400);
    }
    const { auth, collectionId } = c.var.member;
    try {
      if (!(await cacheRelease(discogsReleaseId, auth))) {
        return c.json({ error: `Discogs has no Release ${discogsReleaseId}. Look up the barcode again and pick a Release from the list.` }, 404);
      }
    } catch (error) {
      console.error(`Discogs Release ${discogsReleaseId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return c.json({ error: discogsUnreachable }, 502);
    }
    const [copy] = await db.insert(copies).values({ collectionId, discogsReleaseId, createdAt: now() }).returning();
    const [release] = await db.select().from(releases).where(eq(releases.discogsReleaseId, discogsReleaseId));
    return c.json({ copy: copyView({ copy: copy!, release: release! }) }, 201);
  });

  return routes;
}
