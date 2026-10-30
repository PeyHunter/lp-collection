ALTER TABLE "copies" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "copies" ADD COLUMN "purchase_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "copies" ADD COLUMN "purchase_currency" "currency";--> statement-breakpoint
ALTER TABLE "copies" ADD COLUMN "purchase_date" date;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_purchase_price_has_currency" CHECK (("copies"."purchase_price" is null) = ("copies"."purchase_currency" is null));