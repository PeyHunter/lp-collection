import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "./app.ts";
import type { MemberEnv } from "./member.ts";
import { uuidPattern } from "./member.ts";
import { collections, memberships, users } from "./schema.ts";

export type MemberView = { userId: string; discogsUsername: string; owner: boolean };

/** Who looks after a Collection. Every Member sees the list; only the Owner adds or removes Members, and never themselves. */
export function createMemberRoutes({ database }: AppDependencies) {
  const { db } = database;
  const routes = new Hono<MemberEnv>();

  async function membersOf(collectionId: string): Promise<MemberView[]> {
    return db
      .select({ userId: users.id, discogsUsername: users.discogsUsername, owner: sql<boolean>`${collections.ownerId} = ${users.id}` })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(collections, eq(collections.id, memberships.collectionId))
      .where(eq(memberships.collectionId, collectionId))
      .orderBy(sql`${collections.ownerId} = ${users.id} desc`, asc(sql`lower(${users.discogsUsername})`));
  }

  routes.get("/api/collections/:collectionId/members", async (c) => c.json({ members: await membersOf(c.var.member.collectionId) }));

  routes.post("/api/collections/:collectionId/members", async (c) => {
    const { collectionId, isOwner } = c.var.member;
    if (!isOwner) return c.json({ error: "Only the Collection's Owner can add Members" }, 403);
    const { discogsUsername } = ((await c.req.json().catch(() => undefined)) ?? {}) as { discogsUsername?: unknown };
    const typed = typeof discogsUsername === "string" ? discogsUsername.trim() : "";
    if (!typed || typed.length > 100) return c.json({ error: "Type the Discogs username of the User to add." }, 400);
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.discogsUsername}) = lower(${typed})`);
    if (!user) return c.json({ error: `No User has the Discogs username ${typed}. Send them an Invite first; once they have logged in you can add them.` }, 404);
    const [added] = await db.insert(memberships).values({ collectionId, userId: user.id }).onConflictDoNothing().returning();
    const member = (await membersOf(collectionId)).find((each) => each.userId === user.id);
    return c.json({ member }, added ? 201 : 200);
  });

  routes.delete("/api/collections/:collectionId/members/:userId", async (c) => {
    const { collectionId, isOwner, userId: me } = c.var.member;
    if (!isOwner) return c.json({ error: "Only the Collection's Owner can remove Members" }, 403);
    const userId = c.req.param("userId");
    if (userId === me) return c.json({ error: "The Owner stays a Member of their own Collection." }, 400);
    if (!uuidPattern.test(userId)) return c.json({ error: "No such Member" }, 404);
    const removed = await db
      .delete(memberships)
      .where(and(eq(memberships.collectionId, collectionId), eq(memberships.userId, userId)))
      .returning();
    if (removed.length === 0) return c.json({ error: "No such Member" }, 404);
    return c.body(null, 204);
  });

  return routes;
}
