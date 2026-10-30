CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE FUNCTION release_search_text(artist text, title text, label text, catalog_number text, genres text[], styles text[]) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN lower(concat_ws(' ', artist, title, label, catalog_number, regexp_replace(catalog_number, '[^[:alnum:]]', '', 'g'), array_to_string(genres, ' '), array_to_string(styles, ' ')));--> statement-breakpoint
DROP INDEX "value_snapshots_copy_fetched_idx";--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "genres" text[];--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "styles" text[];--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "search_text" text GENERATED ALWAYS AS (release_search_text("artist", "title", "label", "catalog_number", "genres", "styles")) STORED;--> statement-breakpoint
ALTER TABLE "releases" ADD COLUMN "artist_sort_key" text GENERATED ALWAYS AS (regexp_replace(lower("artist"), '^the\s+', '')) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "releases_search_text_idx" ON "releases" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "value_snapshots_current_idx" ON "value_snapshots" USING btree ("copy_id","currency","media_condition","fetched_at" DESC NULLS FIRST,"id" DESC NULLS FIRST,"value","lowest_listing");
