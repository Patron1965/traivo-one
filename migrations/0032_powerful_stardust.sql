ALTER TABLE "articles" ADD COLUMN "quantity_mode" text DEFAULT 'use_object_quantity';--> statement-breakpoint
ALTER TABLE "order_concept_articles" ADD COLUMN "quantity_mode_override" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "delivery_preference_priority" text;