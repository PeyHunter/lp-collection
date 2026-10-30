import { readBarcodes } from "zxing-wasm/reader";

export type Pixels = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };

export type Area = { x: number; y: number; width: number; height: number; toWidth: number; toHeight: number };

/**
 * ZXing picks one threshold per scan line, so a highlight on a shiny sleeve or a shadow across it
 * hides the bars under it. The local threshold compares each pixel with its own neighbourhood instead.
 */
export const thresholds = ["zxing", "local"] as const;

export type Threshold = (typeof thresholds)[number];

const viewfinderAspect = 4 / 3;
const maxDecodeWidth = 800;
const darkerThanMeanPercent = 97;

/** The part of a camera frame the viewfinder shows (4:3 in styles.css), shrunk to at most maxWidth. */
export function scanArea(frameWidth: number, frameHeight: number, maxWidth = maxDecodeWidth): Area {
  const width = Math.min(frameWidth, Math.round(frameHeight * viewfinderAspect));
  const height = Math.min(frameHeight, Math.round(frameWidth / viewfinderAspect));
  const scale = Math.min(1, maxWidth / width);
  return {
    x: Math.round((frameWidth - width) / 2),
    y: Math.round((frameHeight - height) / 2),
    width,
    height,
    toWidth: Math.round(width * scale),
    toHeight: Math.round(height * scale),
  };
}

export function createReader() {
  let luma = new Uint8Array(0);
  let sums = new Uint32Array(0);
  let out = new Uint8ClampedArray(0);

  function localThreshold({ width, height, data }: Pixels): Pixels {
    const pixels = width * height;
    const stride = width + 1;
    if (luma.length !== pixels) {
      luma = new Uint8Array(pixels);
      sums = new Uint32Array(stride * (height + 1));
      out = new Uint8ClampedArray(pixels * 4);
    }
    for (let y = 0; y < height; y++) {
      let row = 0;
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        const value = (data[pixel * 4]! * 77 + data[pixel * 4 + 1]! * 150 + data[pixel * 4 + 2]! * 29) >> 8;
        luma[pixel] = value;
        row += value;
        sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1]! + row;
      }
    }
    const radius = Math.max(4, Math.round(Math.max(width, height) / 48));
    for (let y = 0; y < height; y++) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      for (let x = 0; x < width; x++) {
        const left = Math.max(0, x - radius);
        const right = Math.min(width, x + radius + 1);
        const sum = sums[bottom * stride + right]! - sums[top * stride + right]! - sums[bottom * stride + left]! + sums[top * stride + left]!;
        const pixel = y * width + x;
        const shade = luma[pixel]! * (bottom - top) * (right - left) * 100 < sum * darkerThanMeanPercent ? 0 : 255;
        out[pixel * 4] = shade;
        out[pixel * 4 + 1] = shade;
        out[pixel * 4 + 2] = shade;
        out[pixel * 4 + 3] = 255;
      }
    }
    return { width, height, data: out };
  }

  return async function read(pixels: Pixels, threshold: Threshold): Promise<string | null> {
    const image = threshold === "local" ? localThreshold(pixels) : pixels;
    const results = await readBarcodes({ width: image.width, height: image.height, data: image.data, colorSpace: "srgb" }, {
      formats: ["EAN13", "UPCA"],
      tryHarder: true,
      tryRotate: true,
      tryInvert: false,
      maxNumberOfSymbols: 1,
    });
    const digits = results.find((result) => result.isValid)?.text;
    if (!digits) return null;
    return digits.length === 13 && digits.startsWith("0") ? digits.slice(1) : digits;
  };
}
