import { expect, test } from "vitest";
import { createTestApp, days } from "../support/test-app.ts";

test("expired sessions are deleted when someone logs in", async () => {
  const app = await createTestApp();
  await app.logIn(app.appOwnerDiscogsUsername);
  app.clock.advance(days(400));

  const fresh = await app.logIn(app.appOwnerDiscogsUsername);

  expect(fresh.session).toBeDefined();
  expect(await app.query("SELECT 1 FROM sessions")).toHaveLength(1);
});

test("login attempts left unfinished for more than 15 minutes are deleted when the next login starts", async () => {
  const app = await createTestApp();
  await app.startLogin();
  app.clock.advance(15 * 60 * 1000 + 1);

  await app.startLogin();

  expect(await app.query("SELECT 1 FROM login_attempts")).toHaveLength(1);
});

test("logging in again in the same browser replaces that browser's session", async () => {
  const app = await createTestApp();
  const first = await app.logIn(app.appOwnerDiscogsUsername);

  const second = await app.logIn(app.appOwnerDiscogsUsername, { headers: { cookie: first.session! } });

  expect((await app.request("/api/me", { headers: { cookie: first.session! } })).status).toBe(401);
  expect((await app.request("/api/me", { headers: { cookie: second.session! } })).status).toBe(200);
  expect(await app.query("SELECT 1 FROM sessions")).toHaveLength(1);
});
