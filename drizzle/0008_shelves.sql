CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shelf_id" uuid NOT NULL,
	"column" integer NOT NULL,
	"row" integer NOT NULL,
	CONSTRAINT "sections_shelf_column_row_unique" UNIQUE("shelf_id","column","row")
);
--> statement-breakpoint
CREATE TABLE "shelves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"columns" integer NOT NULL,
	"rows" integer NOT NULL,
	"corners" jsonb NOT NULL,
	"photo_file_key" text NOT NULL,
	"photo_width" integer NOT NULL,
	"photo_height" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shelves_photo_file_key_unique" UNIQUE("photo_file_key")
);
--> statement-breakpoint
ALTER TABLE "copies" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_shelf_id_shelves_id_fk" FOREIGN KEY ("shelf_id") REFERENCES "public"."shelves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelves" ADD CONSTRAINT "shelves_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shelves_collection_created_idx" ON "shelves" USING btree ("collection_id","created_at");--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copies_section_idx" ON "copies" USING btree ("section_id");