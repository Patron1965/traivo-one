CREATE TABLE "annual_goals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"customer_id" varchar,
	"object_id" varchar,
	"article_type" text NOT NULL,
	"target_count" integer NOT NULL,
	"year" integer NOT NULL,
	"notes" text,
	"source_type" text DEFAULT 'manual',
	"source_id" varchar,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "annual_goals" ADD CONSTRAINT "annual_goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_goals" ADD CONSTRAINT "annual_goals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual_goals" ADD CONSTRAINT "annual_goals_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_annual_goals_tenant" ON "annual_goals" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_tenant_year" ON "annual_goals" USING btree ("tenant_id","year");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_customer" ON "annual_goals" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_annual_goals_object" ON "annual_goals" USING btree ("object_id");