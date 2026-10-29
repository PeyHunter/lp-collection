import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, TransactionRollbackError } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppDependencies } from "./app.ts";
import type { DiscogsGateway, DiscogsIdentity } from "./discogs.ts";
import { collections, invites, loginAttempts, memberships, sessions, users } from "./schema.ts";

const minute = 60 * 1000;
const day = 24 * 60 * minute;
const inviteLifetime = 7 * day;
const loginAttemptLifetime = 15 * minute;
// Browsers cap a cookie's Max-Age at 400 days.
const sessionLifetime = 400 * day;
const sessionCookie = "lp_session";
const loginCookie = "lp_login";

type InviteRow = typeof invites.$inferSelect;

type InviteStatus =
  | { status: "valid"; expiresAt: Date }
  | { status: "used" }
  | { status: "expired" }
  | { status: "unknown" };

function inviteStatus(invite: InviteRow | undefined, now: Date): InviteStatus {
  if (!invite) return { status: "unknown" };
  if (invite.usedAt) return { status: "used" };
  if (now >= invite.expiresAt) return { status: "expired" };
  return { status: "valid", expiresAt: invite.expiresAt };
}

const inviteHttpStatus = { valid: 200, used: 410, expired: 410, unknown: 404 } as const;

type LoginDecision =
  | { kind: "returning-user"; userId: string }
  | { kind: "new-user"; via: { kind: "app-owner" } | { kind: "invite"; inviteId: string } }
  | { kind: "refused" };

function decideLogin(facts: {
  existingUserId: string | undefined;
  isAppOwner: boolean;
  invite: { id: string; status: InviteStatus["status"] } | undefined;
}): LoginDecision {
  if (facts.existingUserId) return { kind: "returning-user", userId: facts.existingUserId };
  if (facts.isAppOwner) return { kind: "new-user", via: { kind: "app-owner" } };
  if (facts.invite?.status === "valid") return { kind: "new-user", via: { kind: "invite", inviteId: facts.invite.id } };
  return { kind: "refused" };
}

export function createAccessRoutes({ database, discogs, now, appOwnerDiscogsUsername, publicUrl }: AppDependencies) {
  const { db } = database;
  const routes = new Hono();
  const secure = publicUrl.protocol === "https:";
  const isAppOwner = (discogsUsername: string) => discogsUsername.toLowerCase() === appOwnerDiscogsUsername.toLowerCase();

  async function findInvite(code: string) {
    const [invite] = await db.select().from(invites).where(eq(invites.codeHash, sha256(code)));
    return invite;
  }

  async function currentUser(c: Context) {
    const token = getCookie(c, sessionCookie);
    if (!token) return undefined;
    const [row] = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now())));
    return row?.user;
  }

  async function signUp(identity: DiscogsIdentity, via: Extract<LoginDecision, { kind: "new-user" }>["via"]) {
    const at = now();
    return db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ ...discogsFields(identity), discogsUserId: identity.discogsUserId, createdAt: at })
        .returning({ id: users.id });
      if (via.kind === "invite") {
        const [claimedWhileStillValid] = await tx
          .update(invites)
          .set({ usedAt: at, usedBy: user!.id })
          .where(and(eq(invites.id, via.inviteId), isNull(invites.usedAt), gt(invites.expiresAt, at)))
          .returning({ id: invites.id });
        if (!claimedWhileStillValid) tx.rollback();
      }
      const [collection] = await tx.insert(collections).values({ ownerId: user!.id, createdAt: at }).returning({ id: collections.id });
      await tx.insert(memberships).values({ collectionId: collection!.id, userId: user!.id });
      return user!.id;
    });
  }

  async function logIn(identity: DiscogsIdentity, inviteId: string | null): Promise<string | undefined> {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.discogsUserId, identity.discogsUserId));
    const [invite] = inviteId ? await db.select().from(invites).where(eq(invites.id, inviteId)) : [];
    const decision = decideLogin({
      existingUserId: existing?.id,
      isAppOwner: isAppOwner(identity.discogsUsername),
      invite: invite && { id: invite.id, status: inviteStatus(invite, now()).status },
    });
    switch (decision.kind) {
      case "returning-user":
        await db.update(users).set(discogsFields(identity)).where(eq(users.id, decision.userId));
        return decision.userId;
      case "new-user":
        try {
          return await signUp(identity, decision.via);
        } catch (error) {
          if (error instanceof TransactionRollbackError) return undefined;
          throw error;
        }
      case "refused":
        return undefined;
    }
  }

  async function startSession(c: Context, userId: string) {
    const token = randomBytes(32).toString("base64url");
    const createdAt = now();
    await db.insert(sessions).values({
      tokenHash: sha256(token),
      userId,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + sessionLifetime),
    });
    setCookie(c, sessionCookie, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: sessionLifetime / 1000,
      secure,
    });
  }

  routes.get("/api/me", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "Not logged in" }, 401);
    const [collection] = await db.select({ id: collections.id }).from(collections).where(eq(collections.ownerId, user.id));
    return c.json({
      discogsUsername: user.discogsUsername,
      canCreateInvites: isAppOwner(user.discogsUsername),
      collection: { id: collection!.id },
    });
  });

  routes.post("/api/invites", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "Not logged in" }, 401);
    if (!isAppOwner(user.discogsUsername)) return c.json({ error: "Only the app's Owner can create Invites" }, 403);
    const code = randomBytes(32).toString("base64url");
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + inviteLifetime);
    await db.insert(invites).values({ codeHash: sha256(code), createdBy: user.id, createdAt, expiresAt });
    return c.json({ url: new URL(`/invite/${code}`, publicUrl).href, expiresAt: expiresAt.toISOString() }, 201);
  });

  routes.get("/api/invites/:code", async (c) => {
    const status = inviteStatus(await findInvite(c.req.param("code")), now());
    return c.json(status, inviteHttpStatus[status.status]);
  });

  routes.get("/api/login", async (c) => {
    const code = c.req.query("invite");
    let inviteId: string | null = null;
    if (code !== undefined) {
      const invite = await findInvite(code);
      if (inviteStatus(invite, now()).status !== "valid") return c.redirect(invitePath(code), 302);
      inviteId = invite!.id;
    }
    const login = await discogs.startLogin(loginCallbackUrl(publicUrl, code));
    const createdAt = now();
    await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(createdAt.getTime() - loginAttemptLifetime)));
    await db.insert(loginAttempts).values({ requestToken: login.requestToken, requestSecret: login.requestSecret, inviteId, createdAt });
    setCookie(c, loginCookie, login.requestToken, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/api/login",
      maxAge: loginAttemptLifetime / 1000,
      secure,
    });
    return c.redirect(login.authorizeUrl, 302);
  });

  routes.get("/api/login/callback", async (c) => {
    const requestToken = c.req.query("oauth_token");
    const verifier = c.req.query("oauth_verifier");
    const code = c.req.query("invite");
    if (!requestToken || !verifier || getCookie(c, loginCookie) !== requestToken) return c.redirect("/", 302);
    deleteCookie(c, loginCookie, { path: "/api/login", secure });
    const [attempt] = await db.delete(loginAttempts).where(eq(loginAttempts.requestToken, requestToken)).returning();
    if (!attempt || now().getTime() - attempt.createdAt.getTime() > loginAttemptLifetime) return c.redirect("/", 302);

    let identity: DiscogsIdentity;
    try {
      identity = await discogs.finishLogin({ requestToken, requestSecret: attempt.requestSecret, verifier });
    } catch (error) {
      console.error(`Discogs login failed: ${error instanceof Error ? error.message : String(error)}`);
      return c.redirect("/", 302);
    }

    const userId = await logIn(identity, attempt.inviteId);
    if (!userId) return c.redirect(attempt.inviteId && code !== undefined ? invitePath(code) : "/", 302);
    await startSession(c, userId);
    return c.redirect("/", 302);
  });

  routes.post("/api/logout", async (c) => {
    const token = getCookie(c, sessionCookie);
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    deleteCookie(c, sessionCookie, { path: "/", secure });
    return c.body(null, 204);
  });

  return routes;
}

function discogsFields(identity: DiscogsIdentity) {
  return {
    discogsUsername: identity.discogsUsername,
    discogsAccessToken: identity.accessToken,
    discogsAccessSecret: identity.accessSecret,
  };
}

function loginCallbackUrl(publicUrl: URL, inviteToShowOnRefusal: string | undefined) {
  const url = new URL("/api/login/callback", publicUrl);
  if (inviteToShowOnRefusal !== undefined) url.searchParams.set("invite", inviteToShowOnRefusal);
  return url.href;
}

function invitePath(code: string) {
  return `/invite/${encodeURIComponent(code)}`;
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
