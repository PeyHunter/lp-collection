import { expect, test } from "vitest";
import { sealStoredDiscogsTokens } from "../../src/server/access.ts";
import { createTestApp } from "../support/test-app.ts";

type StoredUser = { discogs_access_token: string; discogs_access_secret: string };

test("a User's Discogs access token and secret are stored encrypted", async () => {
  const app = await createTestApp();
  await app.logIn(app.appOwnerDiscogsUsername);
  const issued = app.discogs.issuedIdentities[0]!;

  const [stored] = await app.query<StoredUser>("SELECT discogs_access_token, discogs_access_secret FROM users");

  expect(stored!.discogs_access_token).not.toContain(issued.accessToken);
  expect(stored!.discogs_access_secret).not.toContain(issued.accessSecret);
  expect(app.secretBox.open(stored!.discogs_access_token)).toBe(issued.accessToken);
  expect(app.secretBox.open(stored!.discogs_access_secret)).toBe(issued.accessSecret);
});

test("a returning User's new Discogs tokens are stored encrypted too", async () => {
  const app = await createTestApp();
  await app.logIn(app.appOwnerDiscogsUsername);
  await app.logIn(app.appOwnerDiscogsUsername);
  const latest = app.discogs.issuedIdentities[1]!;

  const [stored] = await app.query<StoredUser>("SELECT discogs_access_token, discogs_access_secret FROM users");

  expect(app.secretBox.open(stored!.discogs_access_token)).toBe(latest.accessToken);
  expect(app.secretBox.open(stored!.discogs_access_secret)).toBe(latest.accessSecret);
});

test("tokens stored in plain text before encryption existed are encrypted at startup, once", async () => {
  const app = await createTestApp();
  await app.query(
    `INSERT INTO users (discogs_user_id, discogs_username, discogs_access_token, discogs_access_secret, created_at)
     VALUES (1, 'early-user', 'plain-token', 'plain-secret', now())`,
  );

  await sealStoredDiscogsTokens(app.database, app.secretBox);
  await sealStoredDiscogsTokens(app.database, app.secretBox);
  const [stored] = await app.query<StoredUser>("SELECT discogs_access_token, discogs_access_secret FROM users");

  expect(stored!.discogs_access_token).not.toContain("plain-token");
  expect(app.secretBox.open(stored!.discogs_access_token)).toBe("plain-token");
  expect(app.secretBox.open(stored!.discogs_access_secret)).toBe("plain-secret");
});
