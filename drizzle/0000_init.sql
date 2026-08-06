CREATE TYPE "public"."detection_source" AS ENUM('model', 'user');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('new', 'like_new', 'excellent', 'good', 'fair', 'poor', 'for_parts');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('detected', 'photos_needed', 'ai_identified', 'needs_confirmation', 'confirmed', 'listed', 'sold', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lot_kind" AS ENUM('storage_unit', 'garage', 'home', 'estate', 'office', 'other');--> statement-breakpoint
CREATE TYPE "public"."marketplace" AS ENUM('facebook', 'ebay', 'craigslist', 'offerup', 'generic');--> statement-breakpoint
CREATE TYPE "public"."photo_view" AS ENUM('front', 'side', 'back', 'top', 'label', 'damage', 'serial', 'accessories', 'other');--> statement-breakpoint
CREATE TYPE "public"."scan_kind" AS ENUM('scene', 'photo', 'video');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('uploaded', 'processing', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"frame_id" uuid,
	"label" text NOT NULL,
	"category" text,
	"bbox" jsonb NOT NULL,
	"mask_blob_key" text,
	"confidence" real,
	"source" "detection_source" DEFAULT 'model' NOT NULL,
	"promoted_item_id" uuid,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"format" text NOT NULL,
	"blob_key" text NOT NULL,
	"item_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"product_name" text,
	"manufacturer" text,
	"model" text,
	"msrp_cents" integer,
	"confidence" real,
	"sources" jsonb,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"blob_key" text NOT NULL,
	"view" "photo_view" DEFAULT 'other' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"width" integer,
	"height" integer,
	"byte_size" integer,
	"quality" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"brand" text,
	"model" text,
	"condition" "item_condition",
	"condition_notes" text,
	"dimensions" jsonb,
	"serial_number" text,
	"user_notes" text,
	"estimated_value_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "item_status" DEFAULT 'detected' NOT NULL,
	"created_from_detection_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"result" jsonb,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"price_cents" integer NOT NULL,
	"negotiation_low_cents" integer,
	"category_path" text,
	"condition_label" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "lot_kind" DEFAULT 'other' NOT NULL,
	"location_text" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"blob_key" text NOT NULL,
	"t_ms" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sharpness" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"kind" "scan_kind" NOT NULL,
	"blob_key" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"byte_size" integer,
	"status" "scan_status" DEFAULT 'uploaded' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"condition_tier" "item_condition" NOT NULL,
	"low_cents" integer NOT NULL,
	"high_cents" integer NOT NULL,
	"recommended_cents" integer NOT NULL,
	"comparables" jsonb,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "detections" ADD CONSTRAINT "detections_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detections" ADD CONSTRAINT "detections_frame_id_scan_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."scan_frames"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detections" ADD CONSTRAINT "detections_promoted_item_id_items_id_fk" FOREIGN KEY ("promoted_item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identifications" ADD CONSTRAINT "identifications_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_photos" ADD CONSTRAINT "item_photos_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_frames" ADD CONSTRAINT "scan_frames_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scans" ADD CONSTRAINT "scans_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "detections_scan_idx" ON "detections" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "identifications_item_idx" ON "identifications" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "item_photos_item_idx" ON "item_photos" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_lot_idx" ON "items" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "listings_item_idx" ON "listings" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "lots_user_idx" ON "lots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scan_frames_scan_idx" ON "scan_frames" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "scans_lot_idx" ON "scans" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "valuations_item_idx" ON "valuations" USING btree ("item_id");