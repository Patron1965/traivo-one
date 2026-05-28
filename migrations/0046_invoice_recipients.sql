-- Task #556: Tre fakturanivåer med arv och konfliktvarning (ADR v3 §2.3)
-- Ny tabell invoice_recipients (central/area/local) + frozen-fält på work_orders.
-- Additivt och nullable — bakåtkompatibelt: WO utan frozen_invoice_recipient_id
-- faller tillbaka till object_payers/objects.customer_id i Fortnox-export.

CREATE TABLE IF NOT EXISTS "invoice_recipients" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "customer_id" varchar NOT NULL REFERENCES "customers"("id"),
  "level" text NOT NULL,
  "recipient_name" text NOT NULL,
  "recipient_email" text,
  "recipient_address" text,
  "recipient_postal_code" text,
  "recipient_city" text,
  "recipient_reference" text,
  "fortnox_customer_id" varchar,
  "breaks_inheritance" boolean DEFAULT false NOT NULL,
  "priority" integer DEFAULT 1 NOT NULL,
  "valid_from" timestamp,
  "valid_to" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_invoice_recipients_tenant"
  ON "invoice_recipients" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_recipients_customer"
  ON "invoice_recipients" ("customer_id");
CREATE INDEX IF NOT EXISTS "idx_invoice_recipients_tenant_customer_level"
  ON "invoice_recipients" ("tenant_id", "customer_id", "level");

ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "frozen_invoice_recipient_id" varchar,
  ADD COLUMN IF NOT EXISTS "frozen_invoice_level" text,
  ADD COLUMN IF NOT EXISTS "frozen_invoice_source_customer_id" varchar,
  ADD COLUMN IF NOT EXISTS "invoice_conflict_flag" boolean DEFAULT false;
