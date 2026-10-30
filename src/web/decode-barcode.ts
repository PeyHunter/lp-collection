import { readBarcodes } from "zxing-wasm/reader";

export type Pixels = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };

/**
 * ZXing picks one threshold per scan line, so a highlight on a shiny sleeve or a shadow across it
 * hides the bars under it. The local threshold compares each pixel with its own neighbourhood instead.
 */
export const thresholds = ["zxing", "local"] as const;

export type Threshold = (typeof thresholds)[number];

const darkerThanMean = 0.97;

function luma(data: Uint8ClampedArray, pixel: number) {
  return data[pixel * 4]! * 0.299 + data[pixel * 4 + 1]! * 0.587 + data[pixel * 4 + 2]! * 0.114;
}

function localThreshold({ width, height, data }: Pixels): Pixels {
  const radius = Math.max(4, Math.round(Math.max(width, height) / 48));
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += luma(data, y * width + x);
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1]! + row;
    }
  }
  const out = new Uint8ClampedArray(data.length).fill(255);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const sum = sums[bottom * stride + right]! - sums[top * stride + right]! - sums[bottom * stride + left]! + sums[top * stride + left]!;
      const mean = sum / ((bottom - top) * (right - left));
      if (luma(data, y * width + x) < mean * darkerThanMean) out.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
    }
  }
  return { width, height, data: out };
}

export async function decodeBarcode(pixels: Pixels, threshold: Threshold): Promise<string | null> {
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
}
