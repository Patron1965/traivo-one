-- Task #426 — Daglig hälsokoll på prod-data efter Modus-parallelldrift
-- Lagrar resultatet av varje schemalagd körning av prodHealthCheckService
-- så drift kan upptäckas över tid (plötsligt tapp av kunder, orphans som
-- dyker upp). Övriga tabeller/kolumner som drizzle-kit upptäckte som
-- "saknade" i denna generate skapades tidigare via `npm run db:push` och
-- finns redan i alla aktiva miljöer — därför inkluderas endast den nya
-- tabellen i denna migration. CREATE/INDEX används med IF NOT EXISTS
-- för idempotens.

CREATE TABLE IF NOT EXISTS "prod_health_check_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(255) NOT NULL,
	"ran_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(10) NOT NULL,
	"pass_count" integer DEFAULT 0 NOT NULL,
	"warn_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alert_status" varchar(20),
	"alert_detail" text,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prod_health_tenant_ran" ON "prod_health_check_runs" USING btree ("tenant_id","ran_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prod_health_status" ON "prod_health_check_runs" USING btree ("status");
