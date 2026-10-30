import type { PhotoPoint, ShelfCorners } from "../server/schema.ts";

export const maxGridSide = 26;

/**
 * The perspective transform that takes the shelf front, seen square-on as the unit square,
 * onto the four dragged corners (Heckbert's square-to-quadrilateral solution).
 */
export function perspective([p0, p1, p2, p3]: ShelfCorners): (point: PhotoPoint) => PhotoPoint {
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  return ({ x: u, y: v }) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

export type SectionQuad = { column: number; row: number; points: ShelfCorners };

export function sectionQuads(corners: ShelfCorners, columns: number, rows: number): SectionQuad[] {
  const map = perspective(corners);
  const at = (column: number, row: number) => map({ x: column / columns, y: row / rows });
  const quads: SectionQuad[] = [];
  for (let row = 1; row <= rows; row++) {
    for (let column = 1; column <= columns; column++) {
      quads.push({ column, row, points: [at(column - 1, row - 1), at(column, row - 1), at(column, row), at(column - 1, row)] });
    }
  }
  return quads;
}

export function sectionLabel(column: number, row: number) {
  return `${String.fromCharCode(64 + column)}${row}`;
}

/** True when the corners, in order top left, top right, bottom right, bottom left, turn the same way at every corner. */
export function isConvex(corners: ShelfCorners) {
  return corners.every((corner, index) => {
    const next = corners[(index + 1) % 4]!;
    const after = corners[(index + 2) % 4]!;
    return (next.x - corner.x) * (after.y - next.y) - (next.y - corner.y) * (after.x - next.x) > 1e-6;
  });
}
