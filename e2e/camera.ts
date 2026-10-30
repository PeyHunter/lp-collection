import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { barcodePhoto, straight, y4m, type Shot } from "../test/support/barcode-photo.ts";

/**
 * Chromium's fake rear camera, filming one still photo. Chromium reads the file at launch, so each spec file gets one.
 * The full Chromium build, because the headless shell answers every camera request with NotSupportedError.
 */
export function fakeCamera(shot: Omit<Shot, "width" | "height" | "module" | "light" | "noise" | "blur">) {
  const file = join(mkdtempSync(join(tmpdir(), "lp-collection-camera-")), "camera.y4m");
  writeFileSync(file, y4m(barcodePhoto({ ...straight, ...shot })));
  return { channel: "chromium", launchOptions: { args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${file}`] } };
}

export async function logInAsOwner(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: "Log in with Discogs" }).click();
  await page.getByLabel("Discogs username").fill("owner");
  await page.getByRole("button", { name: "Authorize" }).click();
  await expect(page.getByRole("heading", { name: "Your Collection" })).toBeVisible();
}

/** Records every camera the page opens; the returned function reads whether each is still live or has ended. */
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
