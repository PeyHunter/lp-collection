import { expect, test } from "vitest";
import { createTestApp } from "../support/test-app.ts";

test("the app reports that it and its database are up", async () => {
  const { request } = await createTestApp();

  const response = await request("/api/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", database: "ok" });
});
