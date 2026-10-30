import { Hono } from "hono";
import { createAccessRoutes } from "./access.ts";
import { createCollectionRoutes } from "./collection.ts";
import type { Database } from "./db.ts";
import type { DiscogsGateway } from "./discogs.ts";
import type { ExchangeRates } from "./exchange-rates.ts";
import type { SecretBox } from "./secret-box.ts";

export type AppDependencies = {
  database: Database;
  discogs: DiscogsGateway;
  exchangeRates: ExchangeRates;
  secretBox: SecretBox;
  now: () => Date;
  appOwnerDiscogsUsername: string;
  publicUrl: URL;
  photosDir: string;
};

export function createApp(dependencies: AppDependencies) {
  const { database } = dependencies;
  const app = new Hono();

  app.get("/api/health", async (c) => {
    const reachable = await database.isReachable();
    return c.json({ status: reachable ? "ok" : "degraded", database: reachable ? "ok" : "unreachable" }, reachable ? 200 : 503);
  });

  app.route("/", createAccessRoutes(dependencies));
  app.route("/", createCollectionRoutes(dependencies));

  return app;
}
