-- Task #654: Konsoliderings-livscykel på customer_invoices (ADR v3 §2.5 / Task #558)
-- Kolumnerna definierades i shared/schema.ts men ingen migration lade till dem,
-- så customer_invoices saknade dem i dev/prod/fresh-miljöer. Fakturakö-vyns query
-- (GET /api/invoice-queue/consolidated) refererade obefintliga kolumner → "Kunde
-- inte hämta data". Additivt och bakåtkompatibelt (expand-contract): alla nya
-- kolumner är nullable utom "state" som har default 'pending', så befintliga
-- inserts/Fortnox-export påverkas inte. Idempotent (IF NOT EXISTS) — säker att köra om.

ALTER TABLE "customer_invoices"
  ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "invoice_recipient_id" varchar,
  ADD COLUMN IF NOT EXISTS "consolidation_policy_id" varchar,
  ADD COLUMN IF NOT EXISTS "consolidation_period_start" timestamp,
  ADD COLUMN IF NOT EXISTS "consolidation_period_end" timestamp,
  ADD COLUMN IF NOT EXISTS "held_until" timestamp,
  ADD COLUMN IF NOT EXISTS "released_by" varchar,
  ADD COLUMN IF NOT EXISTS "released_at" timestamp,
  ADD COLUMN IF NOT EXISTS "released_reason" text;

CREATE INDEX IF NOT EXISTS "idx_customer_invoices_tenant_state"
  ON "customer_invoices" ("tenant_id", "state");
CREATE INDEX IF NOT EXISTS "idx_customer_invoices_recipient"
  ON "customer_invoices" ("invoice_recipient_id");
