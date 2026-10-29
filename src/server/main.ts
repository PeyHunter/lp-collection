import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.ts";
import { connectDatabase, migrate } from "./db.ts";
import { createFakeDiscogs, type FakeDiscogs } from "./fake-discogs.ts";
import { createRealDiscogs } from "./real-discogs.ts";
import type { DiscogsGateway } from "./discogs.ts";

type Config = {
  databaseUrl: string;
  port: number;
  appOwnerDiscogsUsername: string;
  publicUrl: URL;
  discogs: { kind: "real"; consumerKey: string; consumerSecret: string } | { kind: "fake" };
};

function readConfig(env: NodeJS.ProcessEnv): Config | { error: string } {
  const { DATABASE_URL, APP_OWNER_DISCOGS_USERNAME } = env;
  if (!DATABASE_URL) return { error: "DATABASE_URL is not set." };
  if (!APP_OWNER_DISCOGS_USERNAME) {
    return { error: "APP_OWNER_DISCOGS_USERNAME is not set. Set it to the Discogs username of the person who may create Invites." };
  }
  const discogs = readDiscogs(env);
  if ("error" in discogs) return discogs;
  const port = Number(env.PORT ?? 3000);
  const publicUrl = readPublicUrl(env, port);
  if ("error" in publicUrl) return publicUrl;
  return { databaseUrl: DATABASE_URL, port, appOwnerDiscogsUsername: APP_OWNER_DISCOGS_USERNAME, publicUrl, discogs };
}

function readDiscogs(env: NodeJS.ProcessEnv): Config["discogs"] | { error: string } {
  const { DISCOGS_CONSUMER_KEY, DISCOGS_CONSUMER_SECRET } = env;
  if (DISCOGS_CONSUMER_KEY && DISCOGS_CONSUMER_SECRET) {
    return { kind: "real", consumerKey: DISCOGS_CONSUMER_KEY, consumerSecret: DISCOGS_CONSUMER_SECRET };
  }
  if (DISCOGS_CONSUMER_KEY || DISCOGS_CONSUMER_SECRET) {
    return { error: "Set both DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET, or neither." };
  }
  if (env.NODE_ENV === "production") {
    return {
      error:
        "DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET are not set, so nobody could log in. Run the Discogs wizard (scripts/wizard/discogs.sh) to register the app with Discogs and store its keys.",
    };
  }
  return { kind: "fake" };
}

function readPublicUrl(env: NodeJS.ProcessEnv, port: number): URL | { error: string } {
  if (!env.PUBLIC_URL) {
    if (env.NODE_ENV === "production") {
      return { error: "PUBLIC_URL is not set. Set it to the address phones open, e.g. https://lp-collection.peytonhunter.com." };
    }
    return new URL(`http://localhost:${port}`);
  }
  const url = URL.parse(env.PUBLIC_URL);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return { error: `PUBLIC_URL must be the address phones open, starting with https:// (got "${env.PUBLIC_URL}").` };
  }
  return new URL(url.origin);
}

const config = readConfig(process.env);
if ("error" in config) {
  console.error(`LP-Collection cannot start: ${config.error}`);
  process.exit(1);
}

let fake: FakeDiscogs | undefined;
let discogs: DiscogsGateway;
if (config.discogs.kind === "real") {
  discogs = createRealDiscogs(config.discogs);
} else {
  console.log("No Discogs keys set: using the fake Discogs, whose login page asks only for a username.");
  discogs = fake = createFakeDiscogs();
}

const database = connectDatabase(config.databaseUrl);
await migrate(database);

const app = createApp({ database, discogs, now: () => new Date(), appOwnerDiscogsUsername: config.appOwnerDiscogsUsername, publicUrl: config.publicUrl });
if (fake) app.route("/", fake.pages);
// The built phone UI; any path the API doesn't own falls back to the single page.
app.use("*", serveStatic({ root: "dist/web" }));
app.get("*", serveStatic({ path: "dist/web/index.html" }));

const server = serve({ fetch: app.fetch, port: config.port }, (info) => console.log(`LP-Collection listening on :${info.port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => database.close().then(() => process.exit(0))));
}
