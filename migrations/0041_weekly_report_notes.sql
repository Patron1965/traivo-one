-- Task #522: Veckomötes-rapport.
-- Tabell för manuella bestämpunkter / beslut som tas på veckomötet.
-- Unik per tenant + ISO-år + ISO-vecka så samma vecka inte kan dubbel-sparas.
-- decisions: fritext för beslut/anteckningar.
-- action_items: jsonb-array [{ text, owner?, due? }] för uppföljningspunkter.

CREATE TABLE IF NOT EXISTS "weekly_report_notes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "iso_year" integer NOT NULL,
  "iso_week" integer NOT NULL,
  "decisions" text DEFAULT '' NOT NULL,
  "action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_by" varchar,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_weekly_report_notes_tenant_year_week"
  ON "weekly_report_notes" ("tenant_id", "iso_year", "iso_week");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_weekly_report_notes_tenant"
  ON "weekly_report_notes" ("tenant_id");
