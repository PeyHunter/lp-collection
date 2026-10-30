import { expect, test } from "vitest";
import { isConvex, perspective, sectionLabel, sectionQuads } from "../src/web/shelf-grid.ts";
import type { ShelfCorners } from "../src/server/schema.ts";

const square: ShelfCorners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const leaning: ShelfCorners = [
  { x: 0.2, y: 0.1 },
  { x: 0.7, y: 0.2 },
  { x: 0.8, y: 0.85 },
  { x: 0.1, y: 0.9 },
];

function closeTo(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

function diagonalsCross([a, b, c, d]: ShelfCorners) {
  const t = ((d.x - a.x) * (d.y - b.y) - (d.y - a.y) * (d.x - b.x)) / ((c.x - a.x) * (d.y - b.y) - (c.y - a.y) * (d.x - b.x));
  return { x: a.x + t * (c.x - a.x), y: a.y + t * (c.y - a.y) };
}

test("the unit square onto itself maps every point to itself", () => {
  const map = perspective(square);
  for (const point of [{ x: 0.25, y: 0.75 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.1 }]) closeTo(map(point), point);
});

test("an upright rectangle stretches the grid evenly", () => {
  const map = perspective([
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.2 },
    { x: 0.9, y: 0.6 },
    { x: 0.1, y: 0.6 },
  ]);
  closeTo(map({ x: 0.5, y: 0.5 }), { x: 0.5, y: 0.4 });
  closeTo(map({ x: 0.25, y: 1 }), { x: 0.3, y: 0.6 });
});

test("a shelf seen at an angle puts its four corners on the dragged dots", () => {
  const map = perspective(leaning);
  closeTo(map({ x: 0, y: 0 }), leaning[0]);
  closeTo(map({ x: 1, y: 0 }), leaning[1]);
  closeTo(map({ x: 1, y: 1 }), leaning[2]);
  closeTo(map({ x: 0, y: 1 }), leaning[3]);
});

test("the middle of a shelf seen at an angle lands where its diagonals cross, not at the average of its corners", () => {
  const middle = perspective(leaning)({ x: 0.5, y: 0.5 });
  closeTo(middle, diagonalsCross(leaning));
  expect(Math.abs(middle.x - 0.45)).toBeGreaterThan(0.001);
});

test("a straight line across the shelf stays straight in the photo", () => {
  const map = perspective(leaning);
  const [a, b, c] = [map({ x: 0, y: 0.3 }), map({ x: 0.4, y: 0.3 }), map({ x: 1, y: 0.3 })];
  expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeCloseTo(0, 12);
});

test("a 4 by 6 shelf has 24 Sections that share their corners with their neighbours", () => {
  const quads = sectionQuads(leaning, 4, 6);
  expect(quads).toHaveLength(24);
  const c4 = quads.find((quad) => quad.column === 3 && quad.row === 4)!;
  const d4 = quads.find((quad) => quad.column === 4 && quad.row === 4)!;
  const c5 = quads.find((quad) => quad.column === 3 && quad.row === 5)!;
  closeTo(c4.points[1], d4.points[0]);
  closeTo(c4.points[3], c5.points[0]);
  closeTo(quads.find((quad) => quad.column === 1 && quad.row === 1)!.points[0], leaning[0]);
  closeTo(quads.find((quad) => quad.column === 4 && quad.row === 6)!.points[2], leaning[2]);
});

test("Sections are labelled by column letter from the left and row number from the top", () => {
  expect(sectionLabel(1, 1)).toBe("A1");
  expect(sectionLabel(3, 4)).toBe("C4");
  expect(sectionLabel(26, 12)).toBe("Z12");
});

test("dots in corner order make a convex shape, and crossed or bunched dots do not", () => {
  expect(isConvex(leaning)).toBe(true);
  expect(isConvex([leaning[0], leaning[2], leaning[1], leaning[3]])).toBe(false);
  expect(isConvex([leaning[0], leaning[0], leaning[2], leaning[3]])).toBe(false);
  expect(isConvex([leaning[1], leaning[0], leaning[3], leaning[2]])).toBe(false);
});
