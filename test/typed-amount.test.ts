import { expect, test } from "vitest";
import { parseTypedAmount, typedAmount } from "../src/web/typed-amount.ts";

test.each([
  ["1200", 1200],
  ["1.200", 1200],
  ["1.200,50", 1200.5],
  ["149,95", 149.95],
  ["1,200", 1200],
  ["1,200.50", 1200.5],
  ["12.5", 12.5],
  [" 2 000 ", 2000],
  ["0", 0],
])("%s reads as %d", (typed, amount) => {
  expect(parseTypedAmount(typed)).toBe(amount);
});

test("an empty field means no Purchase price", () => {
  expect(parseTypedAmount("  ")).toBeNull();
});

test.each(["abc", "-5", "1,2,3", "1.2.3", "12,505.1.2", "10.005,5,5", "kr 100", "1,5.25"])("%s isn't an amount", (typed) => {
  expect(parseTypedAmount(typed)).toBeUndefined();
});

test("a stored amount is shown the Danish way and reads back as the same amount", () => {
  for (const amount of [0, 12.5, 149.95, 1200, 1234567.89]) {
    expect(parseTypedAmount(typedAmount(amount))).toBe(amount);
  }
});
