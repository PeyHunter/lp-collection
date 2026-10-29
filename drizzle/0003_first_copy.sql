CREATE TYPE "public"."condition" AS ENUM('Mint (M)', 'Near Mint (NM or M-)', 'Very Good Plus (VG+)', 'Very Good (VG)', 'Good Plus (G+)', 'Good (G)', 'Fair (F)', 'Poor (P)');--> statement-breakpoint
CREATE TABLE "barcode_lookups" (
	"barcode" text PRIMARY KEY NOT NULL,
	"candidates" jsonb NOT NULL,
	"looked_up_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"discogs_release_id" integer NOT NULL,
	"media_condition" "condition" DEFAULT 'Very Good Plus (VG+)' NOT NULL,
	"sleeve_condition" "condition" DEFAULT 'Very Good Plus (VG+)' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"discogs_release_id" integer PRIMARY KEY NOT NULL,
	"artist" text NOT NULL,
	"title" text NOT NULL,
	"label" text,
	"catalog_number" text,
	"country" text,
	"pressing_year" integer,
	"original_year" integer,
	"cover_image_url" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_discogs_release_id_releases_discogs_release_id_fk" FOREIGN KEY ("discogs_release_id") REFERENCES "public"."releases"("discogs_release_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copies_collection_created_idx" ON "copies" USING btree ("collection_id","created_at");