-- Task #1495: namngivna, återanvändbara kolumnmatchningar för objektimporten
-- (Import 2.0). Tenant-scopad tabell med rubriksignatur + mappning per
-- kolumnindex. Idempotent (IF NOT EXISTS överallt).
CREATE TABLE IF NOT EXISTS object_import_mapping_templates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  header_signature text NOT NULL,
  mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oimt_tenant
  ON object_import_mapping_templates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_oimt_tenant_signature
  ON object_import_mapping_templates (tenant_id, header_signature);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_oimt_tenant_name
  ON object_import_mapping_templates (tenant_id, name);
