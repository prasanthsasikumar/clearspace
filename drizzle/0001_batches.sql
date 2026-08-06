ALTER TABLE "detections" ADD COLUMN "crop_blob_key" text;--> statement-breakpoint
ALTER TABLE "item_photos" ADD COLUMN "source_detection_id" uuid;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX "scans_batch_idx" ON "scans" USING btree ("batch_id");