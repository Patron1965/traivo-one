CREATE TABLE "import_batches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"batch_id" varchar NOT NULL,
	"total_rows" integer DEFAULT 0,
	"created" integer DEFAULT 0,
	"updated" integer DEFAULT 0,
	"errors" integer DEFAULT 0,
	"scorecard_summary" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_import_batches_tenant" ON "import_batches" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_import_batches_batch_id" ON "import_batches" USING btree ("batch_id");