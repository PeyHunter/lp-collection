import { expect, test } from "vitest";
import { closestNames, editDistance } from "../src/server/spelling.ts";

test("edit distance counts inserts, deletes, replacements and swapped neighbours as one change each", () => {
  expect(editDistance("floyd", "floyd")).toBe(0);
  expect(editDistance("floid", "floyd")).toBe(1);
  expect(editDistance("fleetwod", "fleetwood")).toBe(1);
  expect(editDistance("beatels", "beatles")).toBe(1);
  expect(editDistance("", "abc")).toBe(3);
  expect(editDistance("kitten", "sitting")).toBe(3);
});

test("the closest names come first, ignoring case, a leading The and Discogs numbering", () => {
  const names = ["Pink", "P!nk", "Pink Floyd", "Pink Fairies", "Pink Floyd (2)", "The Pink Floyd Tribute"];

  expect(closestNames("pink floid", names, 5)).toEqual(["Pink Floyd"]);
  expect(closestNames("Beatels", ["Beat", "The Beatles", "Beatles Revival Band"], 5)).toEqual(["The Beatles"]);
});

test("names too far off to be a misspelling are left out, and at most the limit is kept", () => {
  expect(closestNames("Fleetwod Mac", ["Fleetwood Mac", "Fleet Foxes", "Mac DeMarco"], 5)).toEqual(["Fleetwood Mac"]);
  expect(closestNames("abba", ["Abba", "ABBA", "Aqua", "Alba", "Abra"], 2)).toEqual(["Abba", "Alba"]);
  expect(closestNames("  ", ["Abba"], 5)).toEqual([]);
});
