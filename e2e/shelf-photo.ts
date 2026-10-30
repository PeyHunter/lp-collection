import type { Page } from "@playwright/test";
import type { ShelfCorners } from "../src/server/schema.ts";

export const shelfPhotoSize = { width: 1200, height: 1600 };

/** Where the drawn shelf's outer corners sit, as fractions of the photo. */
export const drawnCorners: ShelfCorners = [
  { x: 0.2, y: 0.11 },
  { x: 0.78, y: 0.16 },
  { x: 0.76, y: 0.9 },
  { x: 0.23, y: 0.93 },
];

/**
 * Draws a 4 by 6 cube shelf full of records, seen from a little to the left and above,
 * and returns it as a JPEG. The browser draws it so no image fixture is checked in.
 */
export async function drawShelfPhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height, corners }) => {
      const [p0, p1, p2, p3] = corners.map((point) => ({ x: point.x * width, y: point.y * height }));
      const dx1 = p1!.x - p2!.x;
      const dx2 = p3!.x - p2!.x;
      const dx3 = p0!.x - p1!.x + p2!.x - p3!.x;
      const dy1 = p1!.y - p2!.y;
      const dy2 = p3!.y - p2!.y;
      const dy3 = p0!.y - p1!.y + p2!.y - p3!.y;
      const det = dx1 * dy2 - dx2 * dy1;
      const g = (dx3 * dy2 - dx2 * dy3) / det;
      const h = (dx1 * dy3 - dx3 * dy1) / det;
      const map = (u: number, v: number) => {
        const w = g * u + h * v + 1;
        return [(p1!.x - p0!.x + g * p1!.x) * u + (p3!.x - p0!.x + h * p3!.x) * v + p0!.x, (p1!.y - p0!.y + g * p1!.y) * u + (p3!.y - p0!.y + h * p3!.y) * v + p0!.y].map((n) => n / w) as [number, number];
      };

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      const wall = ctx.createLinearGradient(0, 0, width, height);
      wall.addColorStop(0, "#d9cfc0");
      wall.addColorStop(1, "#b7a993");
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#8a7356";
      ctx.fillRect(0, height * 0.9, width, height * 0.1);

      const quad = (u0: number, v0: number, u1: number, v1: number, fill: string) => {
        ctx.beginPath();
        for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as const) ctx.lineTo(...map(u, v));
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      };

      let seed = 7;
      const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const spines = ["#2f4b7c", "#a05195", "#d45087", "#f95d6a", "#ff7c43", "#ffa600", "#3c6e47", "#e8e1d3", "#1b1b1b", "#6b4226", "#5b8db8", "#c9b037"];
      const columns = 4;
      const rows = 6;
      const board = 0.022;

      quad(0, 0, 1, 1, "#efe6d6");
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const u0 = column / columns + board;
          const u1 = (column + 1) / columns - board;
          const v0 = row / rows + board * 0.66;
          const v1 = (row + 1) / rows - board * 0.66;
          quad(u0, v0, u1, v1, "#2a211b");
          const fill = random() < 0.15 ? 0 : 0.35 + random() * 0.6;
          let u = u0 + 0.004;
          while (u < u0 + (u1 - u0) * fill) {
            const thick = 0.004 + random() * 0.006;
            quad(u, v0 + (v1 - v0) * (0.06 + random() * 0.04), Math.min(u + thick, u1), v1, spines[Math.floor(random() * spines.length)]!);
            u += thick + 0.0015;
          }
        }
      }

      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((jpeg) => resolve(jpeg!), "image/jpeg", 0.9));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { ...shelfPhotoSize, corners: drawnCorners },
  );
  return Buffer.from(base64, "base64");
}
