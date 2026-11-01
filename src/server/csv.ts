import type { CopyView } from "./collection.ts";

type Column = { name: string; cell: (copy: CopyView) => string | number | null | undefined; values?: true };

const money = (amount: number | null | undefined) => (amount == null ? null : amount.toFixed(2));

const columns: Column[] = [
  { name: "Artist", cell: (copy) => copy.release.artist },
  { name: "Title", cell: (copy) => copy.release.title },
  { name: "Label", cell: (copy) => copy.release.label },
  { name: "Catalog number", cell: (copy) => copy.release.catalogNumber },
  { name: "Original year", cell: (copy) => copy.release.originalYear },
  { name: "Pressing year", cell: (copy) => copy.release.pressingYear },
  { name: "Media condition", cell: (copy) => copy.mediaCondition },
  { name: "Sleeve condition", cell: (copy) => copy.sleeveCondition },
  { name: "Value", values: true, cell: (copy) => ("value" in copy ? money(copy.value?.value) : null) },
  { name: "Lowest listing", values: true, cell: (copy) => ("value" in copy ? money(copy.value?.lowestListing) : null) },
  {
    name: "Currency",
    values: true,
    cell: (copy) => ("value" in copy && (copy.value?.value != null || copy.value?.lowestListing != null) ? copy.value.currency : null),
  },
  { name: "Purchase price", values: true, cell: (copy) => ("value" in copy ? money(copy.purchasePrice?.amount) : null) },
  { name: "Purchase currency", values: true, cell: (copy) => ("value" in copy ? copy.purchasePrice?.currency : null) },
  { name: "Gain", values: true, cell: (copy) => ("value" in copy ? money(copy.gain) : null) },
  { name: "Note", cell: (copy) => copy.note },
];

/** A spreadsheet opening the file would run text starting with these as a formula, so such text gets a leading apostrophe. */
const formulaStart = /^[=+\-@\t\r]/;

function field(cell: string | number | null | undefined) {
  if (cell == null) return "";
  if (typeof cell === "number") return String(cell);
  const text = formulaStart.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The Collection as CSV: RFC 4180 with CRLF line ends, and a UTF-8 byte order mark so Excel reads Danish letters right.
 * Money is written with two decimals and no thousands separator. Without Show Values every Value column is left out.
 */
export function collectionCsv(copies: CopyView[], showValues: boolean) {
  const shown = columns.filter((column) => showValues || !column.values);
  const lines = [shown.map((column) => column.name), ...copies.map((copy) => shown.map((column) => field(column.cell(copy))))];
  return `\uFEFF${lines.map((line) => `${line.join(",")}\r\n`).join("")}`;
}
