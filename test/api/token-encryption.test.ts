import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
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

test("a login started before the token key changed ends as expired, not as an error", async () => {
  const app = await createTestApp();
  const owner = (await app.logIn(app.appOwnerDiscogsUsername)).session!;
  const created = await app.request("/api/invites", { method: "POST", headers: { cookie: owner } });
  const code = ((await created.json()) as { url: string }).url.split("/invite/")[1]!;
  const returning = await app.startLogin();
  const invitee = await app.startLogin({ invite: code });

  app.restart({ tokenEncryptionKey: randomBytes(32) });
  const returningCallback = await returning.finish(app.appOwnerDiscogsUsername);
  const inviteeCallback = await invitee.finish("friend");

  expect(returningCallback.status).toBe(302);
  expect(returningCallback.headers.get("location")).toBe("/?login=expired");
  expect(inviteeCallback.status).toBe(302);
  expect(inviteeCallback.headers.get("location")).toBe("/?login=expired");
  expect(app.discogs.calls.finishLogin).toBe(1);
  expect((await app.logIn("friend", { invite: code })).location).toBe("/");
});

function startServer(databaseUrl: string, key: Buffer) {
  const server = spawn(process.execPath, ["src/server/main.ts"], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: databaseUrl, DISCOGS: "fake", APP_OWNER_DISCOGS_USERNAME: "owner", PORT: "0", TOKEN_ENCRYPTION_KEY: key.toString("base64") },
  });
  let output = "";
  const collect = (chunk: Buffer) => {
    output += chunk;
    if (output.includes("listening")) server.kill();
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  return new Promise<{ exitCode: number | null; output: string }>((resolve) => server.on("exit", (exitCode) => resolve({ exitCode, output })));
}

test("the app refuses to start with a token key that cannot open the stored Discogs tokens, and says why", async () => {
  const key = randomBytes(32);
  const app = await createTestApp();
  app.restart({ tokenEncryptionKey: key });
  await app.logIn(app.appOwnerDiscogsUsername);

  const wrongKey = await startServer(app.databaseUrl, randomBytes(32));
  const rightKey = await startServer(app.databaseUrl, key);

  expect(wrongKey.output).toContain("TOKEN_ENCRYPTION_KEY cannot open the Discogs tokens already stored");
  expect(wrongKey.output).not.toContain("listening");
  expect(wrongKey.exitCode).toBe(1);
  expect(rightKey.output).toContain("listening");
}, 30_000);
