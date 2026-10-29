import { Hono } from "hono";
import { createAccessRoutes } from "./access.ts";
import type { Database } from "./db.ts";
import type { DiscogsGateway } from "./discogs.ts";

export type AppDependencies = {
  database: Database;
  discogs: DiscogsGateway;
  /** Every expiry check reads this clock, so tests can move time instead of waiting. */
  now: () => Date;
  /** The Discogs username of the person who runs this LP-Collection and alone may create Invites. */
  appOwnerDiscogsUsername: string;
};

export function createApp(dependencies: AppDependencies) {
  const { database } = dependencies;
  const app = new Hono();

  app.get("/api/health", async (c) => {
    const reachable = await database.isReachable();
    return c.json({ status: reachable ? "ok" : "degraded", database: reachable ? "ok" : "unreachable" }, reachable ? 200 : 503);
  });

  app.route("/", createAccessRoutes(dependencies));

  return app;
}
