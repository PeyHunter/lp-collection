CREATE TYPE "public"."import_status" AS ENUM('running', 'done');--> statement-breakpoint
CREATE TABLE "discogs_imports" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid NOT NULL,
	"status" "import_status" DEFAULT 'running' NOT NULL,
	"next_page" integer DEFAULT 1 NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"total" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"claimed_until" timestamp with time zone,
	"last_error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "discogs_imports" ADD CONSTRAINT "discogs_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discogs_imports" ADD CONSTRAINT "discogs_imports_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;