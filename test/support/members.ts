import { expect } from "vitest";
import type { createTestApp } from "./test-app.ts";

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
export type Member = Awaited<ReturnType<typeof logInWithCollection>>;

export async function logInWithCollection(app: TestApp, discogsUsername = app.appOwnerDiscogsUsername, invite?: string) {
  const { session } = await app.logIn(discogsUsername, { invite });
  expect(session).toBeDefined();
  const me = await app.request("/api/me", { headers: { cookie: session! } });
  const { collection } = (await me.json()) as { collection: { id: string } };
  const as = (path: string, init: RequestInit = {}) =>
    app.request(`/api/collections/${collection.id}${path}`, { ...init, headers: { cookie: session!, ...init.headers } });
  return { session: session!, collectionId: collection.id, as };
}

export async function invitedFriend(app: TestApp, ownerSession: string, discogsUsername: string) {
  const created = await app.request("/api/invites", { method: "POST", headers: { cookie: ownerSession } });
  const { url } = (await created.json()) as { url: string };
  return logInWithCollection(app, discogsUsername, url.split("/invite/")[1]);
}

export function saveCopy(user: Member, discogsReleaseId: number) {
  return user.as("/copies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ discogsReleaseId }),
  });
}

export async function listCopies(user: Member) {
  const response = await user.as("/copies");
  expect(response.status).toBe(200);
  return ((await response.json()) as { copies: unknown[] }).copies;
}
