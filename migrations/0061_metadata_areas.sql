-- Task #675: Redigerbara metadata-kategorier ("områden").
-- Tenant-scopad tabell som gör grupperingsfältet metadata_katalog.area redigerbart
-- per kund. Standardlistan seedas i koden (seedDefaultMetadataAreas, isSystem=true)
-- vid första läsning/skrivning; kunder kan lägga till egna kategorier (isSystem=
-- false) och ta bort dem så länge inget metadatafält använder dem.
--
-- Alla satser är idempotenta (IF NOT EXISTS) — säkra att köra om i
-- dev/prod/fresh-miljöer.
CREATE TABLE IF NOT EXISTS "metadata_areas" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "value" varchar(50) NOT NULL,
  "label" varchar(100) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_system" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_metadata_areas_tenant_value"
  ON "metadata_areas" ("tenant_id", "value");

CREATE INDEX IF NOT EXISTS "idx_metadata_areas_tenant"
  ON "metadata_areas" ("tenant_id");
