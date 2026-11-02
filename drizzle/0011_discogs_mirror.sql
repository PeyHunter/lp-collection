CREATE TYPE "public"."mirror_job_kind" AS ENUM('add', 'update', 'remove');--> statement-breakpoint
CREATE TABLE "mirror_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mirror_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"copy_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"kind" "mirror_job_kind" NOT NULL,
	"discogs_release_id" integer NOT NULL,
	"discogs_folder_id" integer,
	"discogs_instance_id" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"claimed_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copies" ADD COLUMN "discogs_folder_id" integer;--> statement-breakpoint
ALTER TABLE "copies" ADD COLUMN "discogs_instance_id" integer;--> statement-breakpoint
ALTER TABLE "mirror_jobs" ADD CONSTRAINT "mirror_jobs_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mirror_jobs_copy_idx" ON "mirror_jobs" USING btree ("copy_id","id");--> statement-breakpoint
CREATE INDEX "mirror_jobs_due_idx" ON "mirror_jobs" USING btree ("next_attempt_at");