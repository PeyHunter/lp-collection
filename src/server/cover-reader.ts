import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppDependencies } from "./app.ts";
import { fixedWindows } from "./login-budget.ts";
import type { MemberEnv } from "./member.ts";

export const coverImageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type CoverImageType = (typeof coverImageTypes)[number];

export const maxCoverBytes = 8 * 1024 * 1024;
const coverReadingLimit = { count: 30, windowMs: 15 * 60 * 1000 };
const maxReadLength = 100;

/** What a Cover reading made out of a photo of the front of a sleeve. Empty strings mean it couldn't tell. */
export type CoverReading = { artist: string; title: string; confidence: "high" | "medium" | "low" };

export type CoverReader = { read(image: { bytes: Uint8Array; mediaType: CoverImageType }): Promise<CoverReading> };

const readingSchema = {
  type: "object",
  properties: {
    artist: { type: "string", description: "The artist or band name as printed, or an empty string if none can be read." },
    title: { type: "string", description: "The album title as printed, or an empty string if none can be read." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["artist", "title", "confidence"],
  additionalProperties: false,
};

const prompt =
  "This is a photo of the front cover of a vinyl LP. Read the artist and the album title printed on it, spelled as printed. " +
  "If the cover shows only one name, decide whether it is the artist or the title. If you recognise the cover but the text is unreadable, give the artist and title you recognise with low confidence. " +
  "If you cannot tell, return empty strings with low confidence.";

export function createClaudeCoverReader(apiKey: string): CoverReader {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  return {
    async read({ bytes, mediaType }) {
      const response = await client.messages.create({
        model: "claude-haiku-5-5",
        max_tokens: 4000,
        output_config: { effort: "low", format: { type: "json_schema", schema: readingSchema } },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(bytes).toString("base64") } },
              { type: "text", text: prompt },
            ],
          },
        ],
      });
      if (response.stop_reason === "refusal") throw new Error("Claude declined to read the cover");
      const text = response.content.find((block) => block.type === "text")?.text;
      if (!text) throw new Error(`Claude answered without a reading (stop reason ${response.stop_reason})`);
      return JSON.parse(text) as CoverReading;
    },
  };
}

/** Reads every photo as the same record, so tests and DISCOGS=fake need no network. */
export function createFakeCoverReader(reading: CoverReading): CoverReader & { reads: number } {
  return {
    reads: 0,
    async read() {
      this.reads += 1;
      return reading;
    },
  };
}

function tidy(read: string) {
  return read.replaceAll(/\s+/g, " ").trim().slice(0, maxReadLength);
}

function isCoverImageType(type: string): type is CoverImageType {
  return (coverImageTypes as readonly string[]).includes(type);
}

export function createCoverRoutes(coverReader: CoverReader, { now }: AppDependencies) {
  const routes = new Hono<MemberEnv>();
  const perUser = fixedWindows(coverReadingLimit, () => now().getTime());

  routes.post(
    "/api/collections/:collectionId/cover-reading",
    bodyLimit({ maxSize: maxCoverBytes, onError: (c) => c.json({ error: "That photo is too big. Photos of the cover up to 8 MB can be read." }, 413) }),
    async (c) => {
      const mediaType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!isCoverImageType(mediaType)) return c.json({ error: "Only photos can be read: JPEG, PNG, WebP or GIF." }, 415);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.length === 0) return c.json({ error: "No photo came through. Take or pick it again." }, 400);
      const budget = perUser.of(c.var.member.userId);
      if (!budget.hasRoom()) return c.json({ error: "You've read a lot of covers in a short time. Wait 15 minutes, or type the artist and title." }, 429);
      budget.spend();
      let reading: CoverReading;
      try {
        reading = await coverReader.read({ bytes, mediaType });
      } catch (error) {
        console.error(`Reading a cover photo failed: ${error instanceof Error ? error.message : String(error)}`);
        return c.json({ error: "The cover couldn't be read right now. Type the artist and title, or try again in a moment." }, 502);
      }
      return c.json<CoverReading>({ artist: tidy(reading.artist), title: tidy(reading.title), confidence: reading.confidence });
    },
  );

  return routes;
}
