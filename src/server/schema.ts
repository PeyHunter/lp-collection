import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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
  showValues: boolean("show_values").notNull().default(true),
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
  /** Null for a Release cached before genres were kept; the next Value fetch fills them in. */
  genres: text("genres").array(),
  styles: text("styles").array(),
  fetchedAt: at("fetched_at").notNull(),
  /** What the Collection search matches: the lowercased fields, with the Catalog number also written without spaces or dashes. */
  searchText: text("search_text").generatedAlwaysAs(
    sql`release_search_text("artist", "title", "label", "catalog_number", "genres", "styles")`,
  ),
  /** The artist as a record shelf files it: lowercased, without a leading "The". */
  artistSortKey: text("artist_sort_key")
    .notNull()
    .generatedAlwaysAs(sql`regexp_replace(lower("artist"), '^the\\s+', '')`),
}, (table) => [index("releases_search_text_idx").using("gin", sql`${table.searchText} gin_trgm_ops`)]);

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });

/** A point on a Shelf photo as fractions of its width and height, so it survives any re-encode of the photo. */
export type PhotoPoint = { x: number; y: number };
/** The Shelf's outer corners in the order top left, top right, bottom right, bottom left. */
export type ShelfCorners = [PhotoPoint, PhotoPoint, PhotoPoint, PhotoPoint];

export const shelves = pgTable(
  "shelves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id),
    name: text("name").notNull(),
    columns: integer("columns").notNull(),
    rows: integer("rows").notNull(),
    corners: jsonb("corners").$type<ShelfCorners>().notNull(),
    photoFileKey: text("photo_file_key").notNull().unique(),
    photoWidth: integer("photo_width").notNull(),
    photoHeight: integer("photo_height").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (table) => [index("shelves_collection_created_idx").on(table.collectionId, table.createdAt)],
);

/** One square of a Shelf, kept by its column and row so a new photo or new corners never change which Copies it holds. */
export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shelfId: uuid("shelf_id")
      .notNull()
      .references(() => shelves.id, { onDelete: "cascade" }),
    column: integer("column").notNull(),
    row: integer("row").notNull(),
  },
  (table) => [unique("sections_shelf_column_row_unique").on(table.shelfId, table.column, table.row)],
);

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
    note: text("note"),
    purchasePrice: money("purchase_price"),
    purchaseCurrency: currency("purchase_currency"),
    purchaseDate: date("purchase_date", { mode: "string" }),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    createdAt: at("created_at").notNull(),
  },
  (table) => [
    index("copies_collection_created_idx").on(table.collectionId, table.createdAt),
    index("copies_section_idx").on(table.sectionId),
    check("copies_purchase_price_has_currency", sql`(${table.purchasePrice} is null) = (${table.purchaseCurrency} is null)`),
  ],
);

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
  (table) => [
    // The latest snapshot per Copy, currency and Media condition is the first entry; Value and Lowest listing ride along so the list reads only the index.
    index("value_snapshots_current_idx").on(
      table.copyId,
      table.currency,
      table.mediaCondition,
      table.fetchedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
      table.value,
      table.lowestListing,
    ),
  ],
);

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    copyId: uuid("copy_id")
      .notNull()
      .references(() => copies.id),
    fileKey: text("file_key").notNull().unique(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (table) => [index("photos_copy_created_idx").on(table.copyId, table.createdAt)],
);
