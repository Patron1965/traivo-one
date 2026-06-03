-- Task #664: Namngivna importmallar (Excel-mall-builder).
-- En tenant-scopad mall = ett namn + en ordnad lista metadata_katalog-ID:n
-- (field_ids). Mallen genererar en Excel med fasta systemkolumner (A–E) plus en
-- dynamisk kolumn per valt fält. Headern härleds vid generering (punktnotation
-- för underfält, annars fältnamnet) — vi lagrar bara ID:n så att rename av ett
-- fält inte spräcker mallen. Inga FK på field_ids (text[] kan ej referera).
--
-- Alla satser är idempotenta (IF NOT EXISTS) — säkra att köra om i
-- dev/prod/fresh-miljöer.
CREATE TABLE IF NOT EXISTS "import_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "name" varchar(120) NOT NULL,
  "description" text,
  "field_ids" text[] NOT NULL DEFAULT '{}',
  "created_by" varchar,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_import_templates_tenant"
  ON "import_templates" ("tenant_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_import_templates_tenant_name"
  ON "import_templates" ("tenant_id", "name");
