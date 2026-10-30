import { expect, test } from "vitest";

test("always fails", () => {
  expect("failure").toBe("reported as a non-zero exit code");
});
