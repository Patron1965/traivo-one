CREATE TABLE "geocoding_missing_snapshots" (
"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"tenant_id" varchar NOT NULL,
"date" text NOT NULL,
"missing_count" integer NOT NULL,
"total_with_address" integer NOT NULL,
"total_objects" integer NOT NULL,
"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "geocoding_missing_snapshots" ADD CONSTRAINT "geocoding_missing_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_geocoding_missing_snap_tenant_date" ON "geocoding_missing_snapshots" USING btree ("tenant_id","date");
