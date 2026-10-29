import { integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  discogsUserId: integer("discogs_user_id").notNull().unique(),
  discogsUsername: text("discogs_username").notNull(),
  discogsAccessToken: text("discogs_access_token").notNull(),
  discogsAccessSecret: text("discogs_access_secret").notNull(),
  createdAt: at("created_at").notNull(),
});

/** Pins the app's Owner, named by username in the settings, to the Discogs account that held that name at their first login. */
export const appOwner = pgTable("app_owner", {
  configuredDiscogsUsername: text("configured_discogs_username").primaryKey(),
  discogsUserId: integer("discogs_user_id").notNull(),
});

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: at("created_at").notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (table) => [primaryKey({ columns: [table.collectionId, table.userId] })],
);

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull().unique(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: at("created_at").notNull(),
  expiresAt: at("expires_at").notNull(),
  usedAt: at("used_at"),
  usedBy: uuid("used_by").references(() => users.id),
});

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: at("created_at").notNull(),
  expiresAt: at("expires_at").notNull(),
});

export const loginAttempts = pgTable("login_attempts", {
  requestToken: text("request_token").primaryKey(),
  requestSecret: text("request_secret").notNull(),
  inviteId: uuid("invite_id").references(() => invites.id),
  inviteCode: text("invite_code"),
  createdAt: at("created_at").notNull(),
});
