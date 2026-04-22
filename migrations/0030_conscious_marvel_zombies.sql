CREATE TABLE IF NOT EXISTS "fortnox_contract_suggestions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"import_batch_id" varchar NOT NULL,
	"customer_id" varchar,
	"fortnox_customer_number" text NOT NULL,
	"customer_name" text NOT NULL,
	"article_number" text,
	"article_description" text NOT NULL,
	"occurrence_count" integer NOT NULL,
	"first_seen" timestamp NOT NULL,
	"last_seen" timestamp NOT NULL,
	"avg_interval_days" real,
	"suggested_billing_cycle" text NOT NULL,
	"avg_price" real,
	"avg_quantity" real,
	"total_revenue" real NOT NULL,
	"monthly_value" real,
	"confidence" real,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_contract_id" varchar,
	"raw_samples" jsonb DEFAULT '[]'::jsonb,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fortnox_contract_suggestions" ADD CONSTRAINT "fortnox_contract_suggestions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fortnox_contract_suggestions" ADD CONSTRAINT "fortnox_contract_suggestions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fortnox_contract_suggestions" ADD CONSTRAINT "fortnox_contract_suggestions_created_contract_id_customer_service_contracts_id_fk" FOREIGN KEY ("created_contract_id") REFERENCES "public"."customer_service_contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fortnox_contract_suggestions" ADD CONSTRAINT "fortnox_contract_suggestions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fortnox_contract_suggestions_tenant" ON "fortnox_contract_suggestions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fortnox_contract_suggestions_status" ON "fortnox_contract_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fortnox_contract_suggestions_batch" ON "fortnox_contract_suggestions" USING btree ("import_batch_id");
