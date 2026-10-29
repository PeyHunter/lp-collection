import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, lte, notLike, or, TransactionRollbackError } from "drizzle-orm";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppDependencies } from "./app.ts";
import type { Database } from "./db.ts";
import { sealedPrefix, type SecretBox } from "./secret-box.ts";
import type { DiscogsIdentity, LoginStart } from "./discogs.ts";
import { appOwner, collections, invites, loginAttempts, memberships, sessions, users } from "./schema.ts";

const minute = 60 * 1000;
const day = 24 * 60 * minute;
const inviteLifetime = 7 * day;
const loginAttemptLifetime = 15 * minute;
// Browsers cap a cookie's Max-Age at 400 days.
const sessionLifetime = 400 * day;
const sessionCookie = "lp_session";
const loginCookie = "lp_login";
const maxPendingLogins = 5;
const maxAnonymousLoginStarts = 10;

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

export function createAccessRoutes({ database, discogs, secretBox, now, appOwnerDiscogsUsername, publicUrl }: AppDependencies) {
  const { db } = database;
  const routes = new Hono();
  const secure = publicUrl.protocol === "https:";
  const configuredOwner = appOwnerDiscogsUsername.toLowerCase();

  async function pinnedAppOwner() {
    const [pinned] = await db.select().from(appOwner).where(eq(appOwner.configuredDiscogsUsername, configuredOwner));
    return pinned?.discogsUserId;
  }

  /** The settings name the Owner by username; the first login under that name pins the Owner to its immutable Discogs user id. */
  async function isAppOwnerLogin(identity: DiscogsIdentity) {
    const pinned = await pinnedAppOwner();
    if (pinned !== undefined) return pinned === identity.discogsUserId;
    if (identity.discogsUsername.toLowerCase() !== configuredOwner) return false;
    await db.insert(appOwner).values({ configuredDiscogsUsername: configuredOwner, discogsUserId: identity.discogsUserId }).onConflictDoNothing();
    return (await pinnedAppOwner()) === identity.discogsUserId;
  }

  async function isAppOwner(user: { discogsUserId: number }) {
    return (await pinnedAppOwner()) === user.discogsUserId;
  }

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

  /** Returns the new User's id, or undefined when a simultaneous login by the same Discogs user signed up first. */
  async function signUp(identity: DiscogsIdentity, via: Extract<LoginDecision, { kind: "new-user" }>["via"]) {
    const at = now();
    return db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ ...discogsFields(identity, secretBox), discogsUserId: identity.discogsUserId, createdAt: at })
        .onConflictDoNothing({ target: users.discogsUserId })
        .returning({ id: users.id });
      if (!user) return undefined;
      if (via.kind === "invite") {
        const [claimedWhileStillValid] = await tx
          .update(invites)
          .set({ usedAt: at, usedBy: user.id })
          .where(and(eq(invites.id, via.inviteId), isNull(invites.usedAt), gt(invites.expiresAt, at)))
          .returning({ id: invites.id });
        if (!claimedWhileStillValid) tx.rollback();
      }
      const [collection] = await tx.insert(collections).values({ ownerId: user.id, createdAt: at }).returning({ id: collections.id });
      await tx.insert(memberships).values({ collectionId: collection!.id, userId: user.id });
      return user.id;
    });
  }

  async function existingUserId(identity: DiscogsIdentity) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.discogsUserId, identity.discogsUserId));
    return existing?.id;
  }

  async function logInReturningUser(identity: DiscogsIdentity, userId: string) {
    await db.update(users).set(discogsFields(identity, secretBox)).where(eq(users.id, userId));
    return userId;
  }

  async function logIn(identity: DiscogsIdentity, inviteId: string | null): Promise<string | undefined> {
    const [invite] = inviteId ? await db.select().from(invites).where(eq(invites.id, inviteId)) : [];
    const decision = decideLogin({
      existingUserId: await existingUserId(identity),
      isAppOwner: await isAppOwnerLogin(identity),
      invite: invite && { id: invite.id, status: inviteStatus(invite, now()).status },
    });
    switch (decision.kind) {
      case "returning-user":
        return logInReturningUser(identity, decision.userId);
      case "new-user": {
        let userId: string | undefined;
        try {
          userId = await signUp(identity, decision.via);
        } catch (error) {
          if (error instanceof TransactionRollbackError) return undefined;
          throw error;
        }
        return userId ?? logInReturningUser(identity, (await existingUserId(identity))!);
      }
      case "refused":
        return undefined;
    }
  }

  async function startSession(c: Context, userId: string) {
    const token = randomBytes(32).toString("base64url");
    const createdAt = now();
    const replaced = getCookie(c, sessionCookie);
    const expired = lte(sessions.expiresAt, createdAt);
    await db.delete(sessions).where(replaced ? or(expired, eq(sessions.tokenHash, sha256(replaced))) : expired);
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
      canCreateInvites: await isAppOwner(user),
      collection: { id: collection!.id },
    });
  });

  routes.post("/api/invites", async (c) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: "Not logged in" }, 401);
    if (!(await isAppOwner(user))) return c.json({ error: "Only the app's Owner can create Invites" }, 403);
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

  function pendingLogins(c: Context) {
    return (getCookie(c, loginCookie) ?? "").split(" ").filter(Boolean);
  }

  function setPendingLogins(c: Context, requestTokens: string[]) {
    if (requestTokens.length === 0) return deleteCookie(c, loginCookie, { path: "/api/login", secure });
    setCookie(c, loginCookie, requestTokens.slice(-maxPendingLogins).join(" "), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/api/login",
      maxAge: loginAttemptLifetime / 1000,
      secure,
    });
  }

  const anonymousLoginStarts = new Map<string, { windowStart: number; count: number }>();

  /** A fixed window per device, because each login start costs a Discogs request and a stored row. */
  function allowAnonymousLoginStart(client: string) {
    const at = now().getTime();
    for (const [key, window] of anonymousLoginStarts) {
      if (at - window.windowStart >= loginAttemptLifetime) anonymousLoginStarts.delete(key);
    }
    const window = anonymousLoginStarts.get(client) ?? { windowStart: at, count: 0 };
    window.count += 1;
    anonymousLoginStarts.set(client, window);
    return window.count <= maxAnonymousLoginStarts;
  }

  routes.get("/api/login", async (c) => {
    const code = c.req.query("invite");
    if (!(await currentUser(c)) && !allowAnonymousLoginStart(clientAddress(c))) {
      return c.redirect(loginProblemPath(code, "too-many"), 302);
    }
    let inviteId: string | null = null;
    if (code !== undefined) {
      const invite = await findInvite(code);
      if (inviteStatus(invite, now()).status !== "valid") return c.redirect(invitePath(code), 302);
      inviteId = invite!.id;
    }
    let login: LoginStart;
    try {
      login = await discogs.startLogin(new URL("/api/login/callback", publicUrl).href);
    } catch (error) {
      console.error(`Discogs could not start a login: ${error instanceof Error ? error.message : String(error)}`);
      return c.redirect(loginProblemPath(code, "discogs-unavailable"), 302);
    }
    const createdAt = now();
    await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(createdAt.getTime() - loginAttemptLifetime)));
    await db.insert(loginAttempts).values({
      requestToken: login.requestToken,
      requestSecret: secretBox.seal(login.requestSecret),
      inviteId,
      inviteCode: code === undefined ? null : secretBox.seal(code),
      createdAt,
    });
    setPendingLogins(c, [...pendingLogins(c), login.requestToken]);
    return c.redirect(login.authorizeUrl, 302);
  });

  routes.get("/api/login/callback", async (c) => {
    const requestToken = c.req.query("oauth_token");
    const verifier = c.req.query("oauth_verifier");
    if (!requestToken || !verifier) return c.redirect(loginProblemPath(undefined, "failed"), 302);
    const [attempt] = await db.select().from(loginAttempts).where(eq(loginAttempts.requestToken, requestToken));
    if (!attempt) return c.redirect(loginProblemPath(undefined, "expired"), 302);
    const code = attempt.inviteCode === null ? undefined : secretBox.open(attempt.inviteCode);
    if (now().getTime() - attempt.createdAt.getTime() > loginAttemptLifetime) return c.redirect(loginProblemPath(code, "expired"), 302);
    const pending = pendingLogins(c);
    if (!pending.includes(requestToken)) return c.redirect(loginProblemPath(code, "cookie-missing"), 302);
    setPendingLogins(c, pending.filter((token) => token !== requestToken));
    const [claimed] = await db.delete(loginAttempts).where(eq(loginAttempts.requestToken, requestToken)).returning();
    if (!claimed) return c.redirect(loginProblemPath(code, "expired"), 302);

    let identity: DiscogsIdentity;
    try {
      identity = await discogs.finishLogin({ requestToken, requestSecret: secretBox.open(attempt.requestSecret), verifier });
    } catch (error) {
      console.error(`Discogs login failed: ${error instanceof Error ? error.message : String(error)}`);
      return c.redirect(loginProblemPath(code, "failed"), 302);
    }

    const userId = await logIn(identity, attempt.inviteId);
    if (!userId) return c.redirect(code === undefined ? "/" : invitePath(code), 302);
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

function discogsFields(identity: DiscogsIdentity, box: SecretBox) {
  return {
    discogsUsername: identity.discogsUsername,
    discogsAccessToken: box.seal(identity.accessToken),
    discogsAccessSecret: box.seal(identity.accessSecret),
  };
}

/** Why a login did not finish, shown to the person on the page they return to. */
type LoginProblem = "cookie-missing" | "expired" | "failed" | "too-many" | "discogs-unavailable";

function loginProblemPath(inviteCode: string | undefined, problem: LoginProblem) {
  return `${inviteCode === undefined ? "/" : invitePath(inviteCode)}?login=${problem}`;
}

/** Behind the Cloudflare Tunnel (ADR-0003) every request comes from cloudflared, and Cloudflare names the phone in CF-Connecting-IP. */
function clientAddress(c: Context) {
  const viaCloudflare = c.req.header("cf-connecting-ip");
  if (viaCloudflare) return viaCloudflare;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

function invitePath(code: string) {
  return `/invite/${encodeURIComponent(code)}`;
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

/** Encrypts Discogs secrets stored before encryption existed. Safe to run on every start. */
export async function sealStoredDiscogsTokens({ db }: Database, box: SecretBox) {
  const stored = await db.select({ id: users.id, token: users.discogsAccessToken, secret: users.discogsAccessSecret }).from(users);
  for (const user of stored) {
    if (box.isSealed(user.token) && box.isSealed(user.secret)) continue;
    await db
      .update(users)
      .set({
        discogsAccessToken: box.isSealed(user.token) ? user.token : box.seal(user.token),
        discogsAccessSecret: box.isSealed(user.secret) ? user.secret : box.seal(user.secret),
      })
      .where(eq(users.id, user.id));
  }
  await db.delete(loginAttempts).where(notLike(loginAttempts.requestSecret, `${sealedPrefix}%`));
}
