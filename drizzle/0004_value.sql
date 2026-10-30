CREATE TYPE "public"."currency" AS ENUM('DKK', 'EUR', 'SEK', 'NOK', 'GBP', 'USD', 'CHF', 'CAD', 'AUD', 'NZD', 'JPY', 'MXN', 'BRL', 'ZAR');--> statement-breakpoint
CREATE TYPE "public"."sleeve_condition" AS ENUM('Mint (M)', 'Near Mint (NM or M-)', 'Very Good Plus (VG+)', 'Very Good (VG)', 'Good Plus (G+)', 'Good (G)', 'Fair (F)', 'Poor (P)', 'Generic', 'Not Graded', 'No Cover');--> statement-breakpoint
CREATE TABLE "value_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "value_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"copy_id" uuid NOT NULL,
	"media_condition" "condition" NOT NULL,
	"value" numeric(12, 2),
	"lowest_listing" numeric(12, 2),
	"currency" "currency" NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copies" ALTER COLUMN "sleeve_condition" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "copies" ALTER COLUMN "sleeve_condition" SET DATA TYPE "public"."sleeve_condition" USING "sleeve_condition"::text::"public"."sleeve_condition";--> statement-breakpoint
ALTER TABLE "copies" ALTER COLUMN "sleeve_condition" SET DEFAULT 'Very Good Plus (VG+)';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "currency" "currency" DEFAULT 'DKK' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "seller_settings_missing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "value_snapshots" ADD CONSTRAINT "value_snapshots_copy_id_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "value_snapshots_copy_fetched_idx" ON "value_snapshots" USING btree ("copy_id","fetched_at");