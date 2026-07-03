-- Tidskoder: per-tenant register över tidskoder (grupp + prioritet) + artikelkoppling.
-- Alla satser är idempotenta (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- och säkra att replaya. Se shared/schema.ts timeCodeDefinitions.

-- 1. Per-tenant register över tidskoder.
CREATE TABLE IF NOT EXISTS time_code_definitions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  label text NOT NULL,
  group_key text NOT NULL DEFAULT 'internt',
  priority integer NOT NULL DEFAULT 2,
  icon_key text,
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_time_code_defs_tenant ON time_code_definitions (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_code_defs_tenant_key ON time_code_definitions (tenant_id, key);

-- 2. Valfri tidskod-referens på artiklar (nullable, back-compat).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS time_code_key text;
