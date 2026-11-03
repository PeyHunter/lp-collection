import { expect, test } from "vitest";
import type { LookupCandidate } from "../src/server/collection.ts";
import { narrow } from "../src/web/narrow.ts";

function candidate(id: number, facts: Partial<LookupCandidate>): LookupCandidate {
  return {
    discogsReleaseId: id,
    artist: "The Beatles",
    title: "Abbey Road",
    label: "Apple Records",
    catalogNumber: "PCS 7088",
    country: "UK",
    pressingYear: 1969,
    formats: ["Vinyl", "LP", "Album"],
    coverImageUrl: null,
    copiesInCollection: 0,
    held: [],
    ...facts,
  };
}

const ukFirst = candidate(1, {});
const ukReissue = candidate(2, { pressingYear: 2019, formats: ["Vinyl", "LP", "Album", "Reissue", "180 Gram"] });
const german = candidate(3, { country: "Germany", label: "Apple Records", catalogNumber: null, pressingYear: 1969, formats: ["Vinyl", "LP", "Album", "Stereo"] });
const all = [ukFirst, ukReissue, german];

test("with nothing picked every candidate is shown and each telling detail is offered, most common first", () => {
  const { shown, differences } = narrow(all, {});
  expect(shown).toEqual(all);
  expect(differences).toEqual([
    { trait: "country", options: [{ value: "UK", count: 2 }, { value: "Germany", count: 1 }] },
    { trait: "pressingYear", options: [{ value: "1969", count: 2 }, { value: "2019", count: 1 }] },
    { trait: "catalogNumber", options: [{ value: "PCS 7088", count: 2 }, { value: "Not listed", count: 1 }] },
    { trait: "formats", options: [{ value: "180 Gram", count: 1 }, { value: "Reissue", count: 1 }, { value: "Stereo", count: 1 }] },
  ]);
});

test("details every candidate has in common are shared, not offered", () => {
  const { shared } = narrow(all, {});
  expect(shared).toEqual([
    { trait: "label", value: "Apple Records" },
    { trait: "formats", value: "Vinyl, LP, Album" },
  ]);
});

test("a pick keeps only the candidates that have it, and stays offered so it can be changed", () => {
  const { shown, differences, shared } = narrow(all, { country: "UK" });
  expect(shown).toEqual([ukFirst, ukReissue]);
  expect(differences.map(({ trait }) => trait)).toEqual(["country", "pressingYear", "formats"]);
  expect(differences[0]).toEqual({ trait: "country", options: [{ value: "UK", count: 2 }, { value: "Germany", count: 1 }] });
  expect(shared).toContainEqual({ trait: "country", value: "UK" });
  expect(shared).toContainEqual({ trait: "catalogNumber", value: "PCS 7088" });
});

test("a format word picks every candidate that lists it", () => {
  const { shown } = narrow(all, { formats: "Reissue" });
  expect(shown).toEqual([ukReissue]);
});

test("picks narrow together until one candidate is left", () => {
  const { shown, differences } = narrow(all, { country: "UK", pressingYear: "1969" });
  expect(shown).toEqual([ukFirst]);
  expect(differences.find(({ trait }) => trait === "pressingYear")?.options).toEqual([
    { value: "1969", count: 1 },
    { value: "2019", count: 1 },
  ]);
});

test("a missing detail can be picked as Not listed", () => {
  expect(narrow(all, { catalogNumber: "Not listed" }).shown).toEqual([german]);
});

test("one candidate has nothing to tell apart", () => {
  expect(narrow([ukFirst], {}).differences).toEqual([]);
});
