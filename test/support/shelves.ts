import { readFile } from "node:fs/promises";
import { expect } from "vitest";
import type { ShelfView } from "../../src/server/shelves.ts";
import type { Member } from "./members.ts";

const photo = await readFile(new URL("../fixtures/photo.jpg", import.meta.url));

/** A 4 × 6 Shelf whose corners are the photo's own. */
export async function createShelf(user: Member, name: string) {
  const body = new FormData();
  body.set("name", name);
  body.set("columns", "4");
  body.set("rows", "6");
  body.set(
    "corners",
    JSON.stringify([
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]),
  );
  body.set("photo", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "shelf.jpg");
  const response = await user.as("/shelves", { method: "POST", body });
  expect(response.status).toBe(201);
  return ((await response.json()) as { shelf: ShelfView }).shelf;
}

export async function putIn(user: Member, copyId: string, sectionId: string | null) {
  const response = await user.as(`/copies/${copyId}/section`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sectionId }) });
  expect(response.status).toBe(204);
}

export const sectionAt = (shelf: ShelfView, column: number, row: number) => shelf.sections.find((section) => section.column === column && section.row === row)!;
