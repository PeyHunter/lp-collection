import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { createPhotoStore } from "./photos.ts";

const fileKeyPattern = /^[0-9a-f]{32}$/;
const digest = (text: string) => createHash("sha256").update(text).digest();

/**
 * The one route the nightly backup on the other node uses: a Photo file by its key. It needs the backup token, and
 * it refuses anything that came in through the Cloudflare tunnel, which marks every request with CF-Connecting-IP.
 */
export function createBackupRoutes(token: string, photosDir: string) {
  const routes = new Hono();
  const photos = createPhotoStore(photosDir);
  const expected = digest(`Bearer ${token}`);

  routes.get("/internal/backup/photos/:fileKey", async (c) => {
    if (c.req.header("cf-connecting-ip") !== undefined) return c.json({ error: "Backups are only fetched inside the cluster" }, 403);
    if (!timingSafeEqual(digest(c.req.header("authorization") ?? ""), expected)) return c.json({ error: "Wrong backup token" }, 401);
    const fileKey = c.req.param("fileKey");
    if (!fileKeyPattern.test(fileKey)) return c.json({ error: "No such photo" }, 404);
    const bytes = await photos.read(fileKey).catch(() => undefined);
    if (!bytes) return c.json({ error: "No such photo" }, 404);
    return c.body(new Uint8Array(bytes), 200, { "content-type": "image/jpeg" });
  });

  return routes;
}
