import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, test } from "vitest";
import { prepareZXingModule } from "zxing-wasm/reader";
import { decodeBarcode, thresholds, type Pixels } from "../src/web/decode-barcode.ts";
import { barcodePhoto, straight, type Shot } from "./support/barcode-photo.ts";

beforeAll(async () => {
  const wasm = await readFile(createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm"));
  await prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer }, fireImmediately: true });
});

async function readAsTheCameraWould(photo: Pixels) {
  for (const threshold of thresholds) {
    const digits = await decodeBarcode(photo, threshold);
    if (digits) return digits;
  }
  return null;
}

const photos: Record<string, Omit<Shot, "barcode">> = {
  straight,
  "tilted 12 degrees and off centre": { ...straight, tilt: 12, offset: [0.03, -0.02] },
  "on a curved sleeve": { ...straight, curve: 1 },
  "under a highlight on a shiny sleeve": { ...straight, glare: { at: [0.45, 0.5], radius: 60, strength: 0.75 } },
  "in dim room light": { ...straight, light: 0.45, noise: 12 },
  "held sideways": { ...straight, tilt: 90, module: 3 },
  "tilted, curved and shiny": { ...straight, tilt: 6, curve: 0.6, glare: { at: [0.55, 0.45], radius: 70, strength: 0.5 } },
  "tilted, curved, dim and shiny at once": { ...straight, tilt: -9, curve: 0.9, light: 0.6, glare: { at: [0.6, 0.45], radius: 50, strength: 0.7 }, noise: 10 },
};

describe.each([
  { kind: "EAN-13", barcode: "5099969209017" },
  { kind: "UPC-A", barcode: "036000291452" },
])("a $kind barcode", ({ barcode }) => {
  test.each(Object.entries(photos))("reads %s", async (_, shot) => {
    expect(await readAsTheCameraWould(barcodePhoto({ ...shot, barcode }))).toBe(barcode);
  });
});

test("a sleeve with no barcode reads as nothing", async () => {
  expect(await readAsTheCameraWould(barcodePhoto({ ...straight, barcode: false }))).toBeNull();
});

test("a sleeve held so the barcode is half out of view reads as nothing rather than a wrong number", async () => {
  expect(await readAsTheCameraWould(barcodePhoto({ ...straight, offset: [0.42, 0.05], barcode: "5099969209017" }))).toBeNull();
});
