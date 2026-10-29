import { Hono } from "hono";
import type { Database } from "./db.ts";
import type { DiscogsGateway } from "./discogs.ts";

export type AppDependencies = {
  database: Database;
  discogs: DiscogsGateway;
};

export function createApp({ database }: AppDependencies) {
  const app = new Hono();

  app.get("/api/health", async (c) => {
    const reachable = await database.isReachable();
    return c.json({ status: reachable ? "ok" : "degraded", database: reachable ? "ok" : "unreachable" }, reachable ? 200 : 503);
  });

  return app;
}
