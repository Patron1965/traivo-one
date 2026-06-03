-- Task #665: Metadata kopplad till uppgift/order.
-- En tenant-scopad koppling = (ordertyp → metadata_katalog-fält). metadata_katalog_id
-- kan peka på ett rotfält ELLER ett familj-förälder-fält; familjen expanderas till
-- sina underfält vid läsning. order_type matchar work_orders.order_type (fri sträng,
-- inget eget register, därför ingen FK). När en order av en viss typ skapas/öppnas
-- visas de kopplade underfälten automatiskt för inmatning som work-order-metadata.
--
-- Alla satser är idempotenta (IF NOT EXISTS) — säkra att köra om i
-- dev/prod/fresh-miljöer. Expand-contract: endast ny tabell, inga befintliga
-- vägar ändras.
CREATE TABLE IF NOT EXISTS "order_type_metadata_links" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "order_type" varchar(100) NOT NULL,
  "metadata_katalog_id" varchar NOT NULL REFERENCES "metadata_katalog"("id") ON DELETE CASCADE,
  "sort_order" integer DEFAULT 0,
  "created_by" varchar,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_order_type_metadata_links_tenant"
  ON "order_type_metadata_links" ("tenant_id");

CREATE INDEX IF NOT EXISTS "idx_order_type_metadata_links_tenant_type"
  ON "order_type_metadata_links" ("tenant_id", "order_type");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_order_type_metadata_links_unique"
  ON "order_type_metadata_links" ("tenant_id", "order_type", "metadata_katalog_id");
