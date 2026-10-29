CREATE TABLE "app_owner" (
	"configured_discogs_username" text PRIMARY KEY NOT NULL,
	"discogs_user_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_attempts" ADD COLUMN "invite_code" text;