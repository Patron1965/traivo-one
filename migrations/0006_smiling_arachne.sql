ALTER TABLE "object_time_restrictions" ADD COLUMN "preference" text DEFAULT 'unfavorable' NOT NULL;--> statement-breakpoint
ALTER TABLE "object_time_restrictions" ADD COLUMN "reason" text;