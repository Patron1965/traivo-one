CREATE TABLE "time_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"resource_id" varchar NOT NULL,
	"week" integer NOT NULL,
	"year" integer NOT NULL,
	"work" integer DEFAULT 0 NOT NULL,
	"travel" integer DEFAULT 0 NOT NULL,
	"setup" integer DEFAULT 0 NOT NULL,
	"break_time" integer DEFAULT 0 NOT NULL,
	"rest" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"budget_hours" integer DEFAULT 40 NOT NULL,
	"resource_name" varchar(255) DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "time_logs" ADD CONSTRAINT "time_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_logs" ADD CONSTRAINT "time_logs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_time_logs_tenant" ON "time_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_time_logs_resource_week" ON "time_logs" USING btree ("resource_id","year","week");