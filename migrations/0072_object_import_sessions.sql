-- Import 2.0 — objektimport-sessioner (Task: Import 2.0 komplett importflöde).
-- Additivt, idempotent. Disjunkt från import_sessions (3-stegs wizard).
CREATE TABLE IF NOT EXISTS object_import_sessions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  file_name text,
  status text NOT NULL DEFAULT 'draft',
  progress integer NOT NULL DEFAULT 0,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation jsonb,
  result jsonb,
  error text,
  created_by varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_object_import_sessions_tenant
  ON object_import_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_object_import_sessions_tenant_status
  ON object_import_sessions (tenant_id, status);
