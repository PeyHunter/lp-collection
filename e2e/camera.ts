import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { barcodePhoto, straight, y4m, type Shot } from "../test/support/barcode-photo.ts";

/**
 * Chromium reads the fake camera's file at launch, so each spec file gets one.
 * The full Chromium build, because the headless shell answers every camera request with NotSupportedError.
 */
export function fakeCamera(shot: Omit<Shot, "width" | "height" | "modulePx" | "light" | "noise" | "blur">) {
  const video = y4m(barcodePhoto({ ...straight, ...shot }));
  const dir = join(import.meta.dirname, "../node_modules/.cache/lp-collection-camera");
  const file = join(dir, `${createHash("sha256").update(video).digest("hex")}.y4m`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    const partial = `${file}.${process.pid}`;
    writeFileSync(partial, video);
    renameSync(partial, file);
  }
  return { channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${file}`] } };
}

export async function watchCameras(page: Page) {
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = [];
    Object.assign(window, { cameraTracks: tracks });
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await open(constraints);
      tracks.push(...stream.getVideoTracks());
      return stream;
    };
  });
  return () => page.evaluate(() => (window as unknown as { cameraTracks: MediaStreamTrack[] }).cameraTracks.map((track) => track.readyState));
}
