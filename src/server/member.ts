import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { sessionUser } from "./access.ts";
import type { AppDependencies } from "./app.ts";
import { memberships } from "./schema.ts";
import type { Valuer } from "./valuation.ts";

export type Member = Valuer & { collectionId: string; sellerSettingsMissing: boolean };
export type MemberEnv = { Variables: { member: Member } };

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function membersOnly({ database, secretBox, now }: AppDependencies) {
  return createMiddleware<MemberEnv>(async (c, next) => {
    const user = await sessionUser(database, now, c);
    if (!user) return c.json({ error: "Not logged in" }, 401);
    const collectionId = c.req.param("collectionId") ?? "";
    const [membership] = uuidPattern.test(collectionId)
      ? await database.db
          .select()
          .from(memberships)
          .where(and(eq(memberships.collectionId, collectionId), eq(memberships.userId, user.id)))
      : [];
    if (!membership) return c.json({ error: "No such Collection" }, 404);
    c.set("member", {
      userId: user.id,
      currency: user.currency,
      sellerSettingsMissing: user.sellerSettingsMissing,
      auth: { token: secretBox.open(user.discogsAccessToken), secret: secretBox.open(user.discogsAccessSecret) },
      collectionId,
    });
    await next();
  });
}
