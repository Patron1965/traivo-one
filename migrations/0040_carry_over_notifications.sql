-- Task #521: Carry-over daglig notis.
-- (1) Lägg till tenant-konfigurerbar tröskel + cron-tid i planning_parameters
--     så att enhetsansvariga kan justera när och vid vilken belastning notisen
--     ska gå ut. Båda är nullable → bakåtkompatibelt; defaultvärden hanteras i
--     applikationen (110% röd-tröskel, 16:00 utskickstid).
-- (2) Skapa user_notification_preferences för per-typ opt-out (default ON);
--     täcker carry_over_warning men generaliserbart för framtida notistyper.
--     Unique-keyen är (tenant_id, user_id, type) så cross-tenant-användare
--     (samma user_id i flera tenants) får oberoende preferences.

ALTER TABLE "planning_parameters"
  ADD COLUMN IF NOT EXISTS "carry_over_threshold_percent" real;--> statement-breakpoint
ALTER TABLE "planning_parameters"
  ADD COLUMN IF NOT EXISTS "carry_over_notification_hour" integer;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "user_id" varchar NOT NULL,
  "type" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_user_notif_pref_tenant_user_type"
  ON "user_notification_preferences" ("tenant_id", "user_id", "type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_notif_pref_tenant"
  ON "user_notification_preferences" ("tenant_id");
