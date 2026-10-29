import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { connectDatabase, migrate } from "./db.ts";
import { createFakeDiscogs } from "./fake-discogs.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const port = Number(process.env.PORT ?? 3000);

const database = connectDatabase(databaseUrl);
await migrate(database);

const app = createApp({ database, discogs: createFakeDiscogs({}) });
// The built phone UI; any path the API doesn't own falls back to the single page.
app.use("*", serveStatic({ root: "dist/web" }));
app.get("*", serveStatic({ path: "dist/web/index.html" }));

const server = serve({ fetch: app.fetch, port }, (info) => console.log(`LP-Collection listening on :${info.port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => database.close().then(() => process.exit(0))));
}
