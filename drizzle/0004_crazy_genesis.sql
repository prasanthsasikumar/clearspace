ALTER TYPE "public"."marketplace" ADD VALUE 'auction';--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "lot_number" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "reserve_cents" integer;