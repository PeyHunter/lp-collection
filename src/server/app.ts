import { Hono } from "hono";
import { createAccessRoutes } from "./access.ts";
import type { Database } from "./db.ts";
import type { DiscogsGateway } from "./discogs.ts";
import type { SecretBox } from "./secret-box.ts";

export type AppDependencies = {
  database: Database;
  discogs: DiscogsGateway;
  secretBox: SecretBox;
  now: () => Date;
  appOwnerDiscogsUsername: string;
  publicUrl: URL;
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
