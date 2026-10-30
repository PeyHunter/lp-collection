import { expect, test } from "vitest";
import { createLoginBudget } from "../src/server/login-budget.ts";

test("strangers from tens of thousands of devices leave the login budget holding only the logins it let through", () => {
  let now = new Date("2026-03-01T12:00:00Z");
  const budget = createLoginBudget(() => now);

  for (let minute = 0; minute < 30; minute++) {
    for (let i = 0; i < 2_000; i++) budget.take({ kind: "logged-out", device: `2001:db8:${minute.toString(16)}:${i.toString(16)}::/64` });
    now = new Date(now.getTime() + 60 * 1000);
  }

  expect(budget.size()).toBeLessThanOrEqual(15 * 10 + 10);
});
