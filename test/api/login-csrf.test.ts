import { expect, test } from "vitest";
import { cookieFrom, createTestApp } from "../support/test-app.ts";

test("a login callback opened in another browser does not log that browser in as whoever started the login", async () => {
  const app = await createTestApp();
  const owner = (await app.logIn(app.appOwnerDiscogsUsername)).session!;
  const inviteFor = async () => {
    const response = await app.request("/api/invites", { method: "POST", headers: { cookie: owner } });
    return ((await response.json()) as { url: string }).url.split("/invite/")[1]!;
  };
  await app.logIn("mallory", { invite: await inviteFor() });
  const victim = (await app.logIn("friend", { invite: await inviteFor() })).session!;

  const start = await app.request("/api/login");
  const attackerLink = app.discogs.authorizeAs(start.headers.get("location")!, "mallory");
  const callback = await app.request(attackerLink, { headers: { cookie: victim } });

  const swapped = cookieFrom(callback, "lp_session");
  const me = swapped ? await (await app.request("/api/me", { headers: { cookie: swapped } })).json() : undefined;
  expect(me).toBeUndefined();
  const victimMe = await (await app.request("/api/me", { headers: { cookie: victim } })).json();
  expect(victimMe).toMatchObject({ discogsUsername: "friend" });
});
