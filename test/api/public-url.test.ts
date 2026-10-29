import { expect, test } from "vitest";
import { createTestApp } from "../support/test-app.ts";

const forged = { host: "evil.example", "x-forwarded-proto": "http" };

test("Invite links and the Discogs callback use the app's public URL, whatever Host the request names", async () => {
  const app = await createTestApp({ publicUrl: "https://lp-collection.example" });

  const login = await app.startLogin({ headers: forged });
  const callbackUrl = app.discogs.authorizeAs(login.authorizeUrl!, app.appOwnerDiscogsUsername);
  const callback = await login.finish(app.appOwnerDiscogsUsername);
  const session = callback.headers.getSetCookie().find((cookie) => cookie.startsWith("lp_session="))!;
  const invite = await app.request("/api/invites", { method: "POST", headers: { ...forged, cookie: session.split(";")[0]! } });

  expect(callbackUrl).toMatch(/^https:\/\/lp-collection\.example\/api\/login\/callback\?/);
  expect(((await invite.json()) as { url: string }).url).toMatch(/^https:\/\/lp-collection\.example\/invite\//);
  expect(session).toMatch(/; Secure/);
});
