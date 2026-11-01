CREATE TABLE "collection_values" (
	"refresh_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"copies" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "collection_values_refresh_id_collection_id_pk" PRIMARY KEY("refresh_id","collection_id")
);
--> statement-breakpoint
CREATE TABLE "value_refreshes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "value_refreshes_month_unique" UNIQUE("month")
);
--> statement-breakpoint
ALTER TABLE "value_snapshots" ADD COLUMN "refresh_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_values" ADD CONSTRAINT "collection_values_refresh_id_value_refreshes_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."value_refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_values" ADD CONSTRAINT "collection_values_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_values_collection_idx" ON "collection_values" USING btree ("collection_id","recorded_at");--> statement-breakpoint
ALTER TABLE "value_snapshots" ADD CONSTRAINT "value_snapshots_refresh_id_value_refreshes_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."value_refreshes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_snapshots" ADD CONSTRAINT "value_snapshots_refresh_copy_unique" UNIQUE("refresh_id","copy_id");