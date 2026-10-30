import { scanArea, type Pixels } from "../../src/web/decode-barcode.ts";

/**
 * Crops a camera frame to the viewfinder and shrinks it the way the Scanner's canvas does.
 * Bilinear sampling, the cheapest filter a browser may use, so a pass here holds for better filters too.
 */
export function scanFrame(frame: Pixels, maxWidth?: number): Pixels {
  const area = scanArea(frame.width, frame.height, maxWidth);
  const data = new Uint8ClampedArray(area.toWidth * area.toHeight * 4);
  const step = area.width / area.toWidth;
  for (let y = 0; y < area.toHeight; y++) {
    const sy = Math.min(frame.height - 1, area.y + (y + 0.5) * step - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(frame.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < area.toWidth; x++) {
      const sx = Math.min(frame.width - 1, area.x + (x + 0.5) * step - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(frame.width - 1, x0 + 1);
      const fx = sx - x0;
      for (let channel = 0; channel < 4; channel++) {
        const at = (px: number, py: number) => frame.data[(py * frame.width + px) * 4 + channel]!;
        const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
        const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
        data[(y * area.toWidth + x) * 4 + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return { width: area.toWidth, height: area.toHeight, data };
}
