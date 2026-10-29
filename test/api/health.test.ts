import { expect, test } from "vitest";
import { createTestApp } from "../support/test-app.ts";

test("the app reports that it and its database are up", async () => {
  const { request } = await createTestApp();

  const response = await request("/api/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", database: "ok" });
});

test("the app keeps working after PostgreSQL drops its connections", async () => {
  const { request, dropDatabaseConnections } = await createTestApp();
  await request("/api/health");

  await dropDatabaseConnections();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const response = await request("/api/health");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", database: "ok" });
});
