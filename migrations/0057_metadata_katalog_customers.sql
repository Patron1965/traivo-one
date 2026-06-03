-- Task #663: Kundlåsta metadatafält.
-- m2m-koppling mellan metadata_katalog och customers. Ingen rad för ett fält =
-- generellt fält (gäller alla kunder). En eller flera rader = kundlåst fält som
-- endast visas för objekt vars kund är en kopplad kund eller en ättling till en
-- kopplad kund (hierarkin agerar "kategori"). Scope-upplösning sker i koden.
--
-- Alla satser är idempotenta (IF NOT EXISTS) — säkra att köra om i
-- dev/prod/fresh-miljöer. ON DELETE CASCADE rensar kopplingar när ett katalogfält
-- eller en kund raderas.
CREATE TABLE IF NOT EXISTS "metadata_katalog_customers" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "metadata_katalog_id" varchar NOT NULL REFERENCES "metadata_katalog"("id") ON DELETE CASCADE,
  "customer_id" varchar NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_metadata_katalog_customers_unique"
  ON "metadata_katalog_customers" ("metadata_katalog_id", "customer_id");

CREATE INDEX IF NOT EXISTS "idx_metadata_katalog_customers_tenant"
  ON "metadata_katalog_customers" ("tenant_id");

CREATE INDEX IF NOT EXISTS "idx_metadata_katalog_customers_customer"
  ON "metadata_katalog_customers" ("tenant_id", "customer_id");
