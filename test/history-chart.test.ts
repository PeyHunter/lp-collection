import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { HistoryChart, type HistoryPoint } from "../src/web/Value.tsx";

const chart = (points: HistoryPoint[]) => renderToStaticMarkup(createElement(HistoryChart, { points, currency: "DKK", label: "Value history" }));
const month = (n: number) => `2026-0${n}-01T03:00:00.000Z`;

test("the chart joins the months oldest to newest, lowest Value at the bottom, and says where it starts and ends", () => {
  const svg = chart([
    { recordedAt: month(1), value: 100 },
    { recordedAt: month(2), value: 300 },
    { recordedAt: month(3), value: 200 },
  ]);

  expect(svg).toContain('points="0,36 50,4 100,20"');
  expect(svg).toContain('aria-label="Value history: 100 kr in Jan 2026, 200 kr in Mar 2026"');
});

test("a month with no Value breaks the line, and fewer than two Values draw nothing", () => {
  const svg = chart([
    { recordedAt: month(1), value: 100 },
    { recordedAt: month(2), value: 200 },
    { recordedAt: month(3), value: null },
    { recordedAt: month(4), value: 150 },
    { recordedAt: month(5), value: 150 },
  ]);

  expect(svg.match(/<polyline/g)).toHaveLength(2);
  expect(chart([{ recordedAt: month(1), value: 100 }, { recordedAt: month(2), value: null }])).toBe("");
});
