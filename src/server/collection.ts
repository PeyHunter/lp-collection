import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { sessionUser } from "./access.ts";
import type { AppDependencies } from "./app.ts";
import { conditions, sleeveConditions, type Condition, type DiscogsAuth, type ReleaseCandidate, type SleeveCondition } from "./discogs.ts";
import type { SecretBox } from "./secret-box.ts";
import { barcodeLookupCache, copies, memberships, releases, users } from "./schema.ts";
import { createValuation, type CopyValue, type ValuationOutcome, type Valuer } from "./valuation.ts";

type Member = Valuer & { collectionId: string; sellerSettingsMissing: boolean };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const discogsUnreachable = "Discogs didn't answer. Try again in a moment.";
const valueBatchSize = 5;
const failedValueRetryMs = 15 * 60_000;

function parseBarcode(typed: string | undefined) {
  const digits = (typed ?? "").replaceAll(/[\s-]/g, "");
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits : undefined;
}

function parseConditions(body: unknown): { mediaCondition?: Condition; sleeveCondition?: SleeveCondition } | undefined {
  const { mediaCondition, sleeveCondition } = (body ?? {}) as Record<string, unknown>;
  if (mediaCondition === undefined && sleeveCondition === undefined) return undefined;
  if (mediaCondition !== undefined && !(conditions as readonly unknown[]).includes(mediaCondition)) return undefined;
  if (sleeveCondition !== undefined && !(sleeveConditions as readonly unknown[]).includes(sleeveCondition)) return undefined;
  return { mediaCondition: mediaCondition as Condition | undefined, sleeveCondition: sleeveCondition as SleeveCondition | undefined };
}

function discogsAuth(user: typeof users.$inferSelect, box: SecretBox): DiscogsAuth {
  return { token: box.open(user.discogsAccessToken), secret: box.open(user.discogsAccessSecret) };
}

function copyView(row: { copy: typeof copies.$inferSelect; release: typeof releases.$inferSelect }, value: CopyValue | undefined) {
  const { fetchedAt: _, ...release } = row.release;
  return {
    id: row.copy.id,
    mediaCondition: row.copy.mediaCondition,
    sleeveCondition: row.copy.sleeveCondition,
    addedAt: row.copy.createdAt.toISOString(),
    value: value ?? null,
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

export function createCollectionRoutes({ database, discogs, exchangeRates, secretBox, now }: AppDependencies) {
  const { db } = database;
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
    return rows.map((row) => copyView(row, values.get(row.copy.id)));
  }

  async function oneCopy({ collectionId, currency }: Member, copyId: string) {
    if (!uuidPattern.test(copyId)) return undefined;
    const [row] = await db
      .select({ copy: copies, release: releases })
      .from(copies)
      .innerJoin(releases, eq(releases.discogsReleaseId, copies.discogsReleaseId))
      .where(and(eq(copies.id, copyId), eq(copies.collectionId, collectionId)));
    if (!row) return undefined;
    return copyView(row, (await valuation.currentValues({ copyId }, currency)).get(copyId));
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
    const changes = parseConditions(await c.req.json().catch(() => undefined));
    if (!changes) return c.json({ error: "Say the new Media condition or Sleeve condition on the Discogs scale." }, 400);
    const [copy] = await db.update(copies).set(changes).where(eq(copies.id, copyId)).returning();
    const outcome = copy!.mediaCondition !== before.mediaCondition || !before.value ? await valuation.fetchValue(copy!, member) : undefined;
    return c.json({
      copy: await oneCopy(member, copyId),
      sellerSettingsMissing: sellerSettingsMissingAfter(outcome, member.sellerSettingsMissing),
    });
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
