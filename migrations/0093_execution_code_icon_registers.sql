-- Task #942: Utförandekod-register + ikonregister.
-- Alla satser är idempotenta (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- och säkra att replaya.

-- 1. Per-tenant register över utförandekoder.
CREATE TABLE IF NOT EXISTS execution_code_definitions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_execution_code_defs_tenant ON execution_code_definitions (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_code_defs_tenant_key ON execution_code_definitions (tenant_id, key);

-- 2. Per-tenant ikonregister.
CREATE TABLE IF NOT EXISTS icon_definitions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  label text NOT NULL,
  lucide_name text NOT NULL DEFAULT 'package',
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_icon_defs_tenant ON icon_definitions (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_icon_defs_tenant_key ON icon_definitions (tenant_id, key);

-- 3. Valfri ikon-referens på artiklar (nullable, back-compat).
ALTER TABLE articles ADD COLUMN IF NOT EXISTS icon_key text;
