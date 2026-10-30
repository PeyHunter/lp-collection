import type { Pixels } from "../../src/web/decode-barcode.ts";

const leftOdd = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const leftEven = leftOdd.map((code) => [...code].map((bit) => (bit === "1" ? "0" : "1")).reverse().join(""));
const right = leftOdd.map((code) => [...code].map((bit) => (bit === "1" ? "0" : "1")).join(""));
const parity = ["OOOOOO", "OOEOEE", "OOEEOE", "OOEEEO", "OEOOEE", "OEEOOE", "OEEEOO", "OEOEOE", "OEOEEO", "OEEOEO"];

export function ean13Modules(barcode: string) {
  const digits = (barcode.length === 12 ? `0${barcode}` : barcode).split("").map(Number);
  if (digits.length !== 13) throw new Error(`not an EAN-13 or UPC-A: ${barcode}`);
  const check = (10 - (digits.slice(0, 12).reduce((sum, digit, index) => sum + digit * (index % 2 ? 3 : 1), 0) % 10)) % 10;
  if (check !== digits[12]) throw new Error(`bad check digit in ${barcode}, expected ${check}`);
  const left = digits.slice(1, 7).map((digit, index) => (parity[digits[0]!]![index] === "O" ? leftOdd : leftEven)[digit]);
  const rightHalf = digits.slice(7).map((digit) => right[digit]);
  return `101${left.join("")}01010${rightHalf.join("")}101`;
}

export type Shot = {
  width: number;
  height: number;
  modulePx: number;
  tiltDegrees: number;
  offset: [number, number];
  curve: number;
  glare?: { at: [number, number]; radiusPx: number; strength: number };
  light: number;
  noise: number;
  blur: number;
  barcode: string | false;
};

export const straight: Omit<Shot, "barcode"> = { width: 640, height: 480, modulePx: 4, tiltDegrees: 0, offset: [0, 0], curve: 0, light: 1, noise: 6, blur: 1 };

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function barcodePhoto(shot: Shot): Pixels {
  const { width, height, modulePx: module } = shot;
  const modules = shot.barcode === false ? "" : ean13Modules(shot.barcode);
  const quiet = 11;
  const labelWidth = (modules.length + quiet * 2) * module;
  const labelHeight = module * 40;
  const barTop = module * 4;
  const barBottom = labelHeight - module * 6;
  const angle = (shot.tiltDegrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const centreX = width * (0.5 + shot.offset[0]);
  const centreY = height * (0.5 + shot.offset[1]);
  const noise = random(modules.length * 7919 + Math.round(shot.tiltDegrees * 100) + 1);
  const gray = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centreX;
      const dy = y - centreY;
      let u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (shot.curve > 0) {
        const half = labelWidth / 2 + module * 30;
        const t = Math.max(-0.999, Math.min(0.999, u / half));
        u = (Math.asin(t * Math.sin(shot.curve)) / shot.curve) * half;
      }
      const lu = u + labelWidth / 2;
      const lv = v + labelHeight / 2;
      let value = 70 + 25 * Math.sin(x / 37) + 15 * Math.cos(y / 23);
      if (modules && lu >= 0 && lu < labelWidth && lv >= 0 && lv < labelHeight) {
        value = 235;
        const index = Math.floor(lu / module) - quiet;
        const guard = index < 3 || (index >= 45 && index < 50) || index >= 92;
        const bottom = guard ? barBottom + module * 4 : barBottom;
        if (index >= 0 && index < modules.length && lv >= barTop && lv < bottom && modules[index] === "1") value = 25;
      }
      value *= shot.light;
      if (shot.glare) {
        const gx = x - width * shot.glare.at[0];
        const gy = y - height * shot.glare.at[1];
        const falloff = Math.exp(-(gx * gx + gy * gy) / (2 * shot.glare.radiusPx * shot.glare.radiusPx));
        value += (255 - value) * shot.glare.strength * falloff;
      }
      gray[y * width + x] = value + (noise() - 0.5) * 2 * shot.noise;
    }
  }

  const blurred = boxBlur(gray, width, height, shot.blur);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = blurred[i]! * 1.02;
    data[i * 4 + 1] = blurred[i]!;
    data[i * 4 + 2] = blurred[i]! * 0.94;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function boxBlur(source: Float32Array, width: number, height: number, radius: number) {
  if (radius <= 0) return source;
  const out = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const sx = x + ox;
          const sy = y + oy;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
          sum += source[sy * width + sx]!;
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

export function y4m(pixels: Pixels) {
  const { width, height, data } = pixels;
  const luma = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) luma[i] = Math.round(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!);
  const chroma = Buffer.alloc((width / 2) * (height / 2) * 2, 128);
  return Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\nFRAME\n`), luma, chroma]);
}
