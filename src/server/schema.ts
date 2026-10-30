import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { conditions, currencies, defaultCondition, defaultCurrency, sleeveConditions, type ReleaseCandidate } from "./discogs.ts";

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const currency = pgEnum("currency", currencies);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  discogsUserId: integer("discogs_user_id").notNull().unique(),
  discogsUsername: text("discogs_username").notNull(),
  discogsAccessToken: text("discogs_access_token").notNull(),
  discogsAccessSecret: text("discogs_access_secret").notNull(),
  currency: currency("currency").notNull().default(defaultCurrency),
  sellerSettingsMissing: boolean("seller_settings_missing").notNull().default(false),
  createdAt: at("created_at").notNull(),
});

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
  verifierChecks: integer("verifier_checks").notNull().default(0),
  createdAt: at("created_at").notNull(),
});

export const condition = pgEnum("condition", conditions);
export const sleeveCondition = pgEnum("sleeve_condition", sleeveConditions);

export const barcodeLookupCache = pgTable("barcode_lookup_cache", {
  barcode: text("barcode").primaryKey(),
  candidates: jsonb("candidates").$type<ReleaseCandidate[]>().notNull(),
  lookedUpAt: at("looked_up_at").notNull(),
});

export const releases = pgTable("releases", {
  discogsReleaseId: integer("discogs_release_id").primaryKey(),
  artist: text("artist").notNull(),
  title: text("title").notNull(),
  label: text("label"),
  catalogNumber: text("catalog_number"),
  country: text("country"),
  pressingYear: integer("pressing_year"),
  originalYear: integer("original_year"),
  coverImageUrl: text("cover_image_url"),
  fetchedAt: at("fetched_at").notNull(),
});

export const copies = pgTable(
  "copies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id),
    discogsReleaseId: integer("discogs_release_id")
      .notNull()
      .references(() => releases.discogsReleaseId),
    mediaCondition: condition("media_condition").notNull().default(defaultCondition),
    sleeveCondition: sleeveCondition("sleeve_condition").notNull().default(defaultCondition),
    createdAt: at("created_at").notNull(),
  },
  (table) => [index("copies_collection_created_idx").on(table.collectionId, table.createdAt)],
);

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });

/** One Value fetch for a Copy, kept so the Value history can be drawn. A null Value means Discogs had no suggestion. */
export const valueSnapshots = pgTable(
  "value_snapshots",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    copyId: uuid("copy_id")
      .notNull()
      .references(() => copies.id, { onDelete: "cascade" }),
    mediaCondition: condition("media_condition").notNull(),
    value: money("value"),
    lowestListing: money("lowest_listing"),
    currency: currency("currency").notNull(),
    fetchedAt: at("fetched_at").notNull(),
  },
  (table) => [index("value_snapshots_copy_fetched_idx").on(table.copyId, table.fetchedAt)],
);
