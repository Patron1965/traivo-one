CREATE TABLE "budget_alert_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"threshold_percent" integer NOT NULL,
	"current_usage_usd" real NOT NULL,
	"monthly_budget_usd" real NOT NULL,
	"percent_used" real NOT NULL,
	"month_key" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling_locks" (
	"tenant_id" varchar PRIMARY KEY NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_budget_alert_tenant_month" ON "budget_alert_log" USING btree ("tenant_id","month_key");