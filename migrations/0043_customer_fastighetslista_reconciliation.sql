-- Task #550: Årlig kund-fastighetslista — import & avstämning
-- Idempotent: kan köras flera gånger utan biverkningar.
-- Komplement till `npm run db:push`; tas också med i scripts/post-merge.sh så
-- env som föredrar SQL-migrationer (prod) får schema-ändringen explicit.

-- 1) Ny tabell: per-kund sparad kolumnmappning för fastighetslista-uppladdning.
--    columnMap = { systemField: csvColumn, ... }. sourceFingerprint = MD5 av
--    sorterade lowercase-headers — används för att auto-hoppa över mappnings-
--    steget vid identisk filstruktur.
CREATE TABLE IF NOT EXISTS "customer_import_mappings" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "customer_id" varchar NOT NULL REFERENCES "customers"("id"),
  "label" text,
  "column_map" jsonb NOT NULL,
  "source_fingerprint" text,
  "last_used_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_import_mappings_tenant_customer"
  ON "customer_import_mappings" ("tenant_id", "customer_id");--> statement-breakpoint

-- 2) Reconciliation-flaggor på objects. Sätts när ett objekt finns i Traivo
--    men saknas i kundens senaste fastighetslista. Inget raderas automatiskt
--    — bara flagga för manuell granskning + möjlighet att backa hela batchen.
ALTER TABLE "objects" ADD COLUMN IF NOT EXISTS "reconciliation_flag" text;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN IF NOT EXISTS "reconciliation_flagged_at" timestamp;--> statement-breakpoint
ALTER TABLE "objects" ADD COLUMN IF NOT EXISTS "reconciliation_batch_id" text;
