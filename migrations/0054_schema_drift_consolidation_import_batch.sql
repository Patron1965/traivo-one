-- Task #655: Täpp till schema-drift mellan shared/schema.ts och faktisk DB.
-- Följande var definierat i shared/schema.ts men saknade migration i replay-listan,
-- vilket gav "Kunde inte hämta data" så fort en vy frågade efter dem (samma klass
-- av fel som #654). Allt nedan är additivt och bakåtkompatibelt (expand-contract):
-- nya kolumner är nullable, ny tabell skapas tom. Idempotent (IF NOT EXISTS) —
-- säkert att köra om i dev/prod/fresh-miljöer.

-- === work_orders: konsoliderings-state (ADR v3 §2.5 / Task #558) ===
-- invoice_queue_state: NULL=ej redo, pending/held/consolidated/exported.
ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "invoice_queue_state" text,
  ADD COLUMN IF NOT EXISTS "invoice_ready_at" timestamp,
  ADD COLUMN IF NOT EXISTS "invoice_held_until" timestamp,
  ADD COLUMN IF NOT EXISTS "consolidation_invoice_id" varchar;

CREATE INDEX IF NOT EXISTS "idx_work_orders_invoice_queue"
  ON "work_orders" ("tenant_id", "invoice_queue_state");

-- === invoice_consolidation_policies: ny tabell (ADR v3 §2.5 / Task #558) ===
CREATE TABLE IF NOT EXISTS "invoice_consolidation_policies" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "customer_id" varchar REFERENCES "customers"("id"),
  "invoice_recipient_id" varchar REFERENCES "invoice_recipients"("id"),
  "period" text NOT NULL,
  "period_anchor" integer,
  "release_at_hour" integer DEFAULT 6,
  "active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_invoice_consolidation_policies_tenant"
  ON "invoice_consolidation_policies" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_consolidation_policies_recipient"
  ON "invoice_consolidation_policies" ("invoice_recipient_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_consolidation_policies_customer"
  ON "invoice_consolidation_policies" ("customer_id");

-- === import_batch_id på object_payers + invoice_recipients (Task #569) ===
-- Migration 0047 introducerade dessa men låg aldrig i post-merge-replayen, så
-- fresh/prod-DB saknade dem. Återupprepas här (idempotent) och 0047 läggs till
-- i replay-listan så framtida miljöer också får dem.
ALTER TABLE "object_payers" ADD COLUMN IF NOT EXISTS "import_batch_id" text;
ALTER TABLE "invoice_recipients" ADD COLUMN IF NOT EXISTS "import_batch_id" text;
CREATE INDEX IF NOT EXISTS "idx_object_payers_import_batch"
  ON "object_payers" ("import_batch_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_recipients_import_batch"
  ON "invoice_recipients" ("import_batch_id");
