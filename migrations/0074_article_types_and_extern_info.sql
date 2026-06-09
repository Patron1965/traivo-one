-- Task #834: Artikel Fas 1 — artikeltyp-register, extern-info-fil, quantity-migrering.
-- Alla satser är idempotenta (IF NOT EXISTS / villkorad UPDATE) och säkra att replaya.

-- 1. Ny nullable kolumn för extern info-fil (säkerhetsdatablad m.m.) på artiklar.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS extern_info_file_url text;

-- 2. Per-tenant register över artikeltyper.
CREATE TABLE IF NOT EXISTS article_type_definitions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_article_type_defs_tenant ON article_type_definitions (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_article_type_defs_tenant_key ON article_type_definitions (tenant_id, key);

-- 3. Migrera äldre quantity-lägen till per_styck (samma beteende: bas × objektets antal).
UPDATE articles
   SET quantity_mode = 'per_styck'
 WHERE quantity_mode IN ('use_object_quantity', 'configurable');

UPDATE order_concept_articles
   SET quantity_mode_override = 'per_styck'
 WHERE quantity_mode_override IN ('use_object_quantity', 'configurable');
