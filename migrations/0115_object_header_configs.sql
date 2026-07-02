-- Objektöversikt Fas 1: header-konfiguration per objekttyp.
-- Admin pekar in bild-/kart-brickor + upp till tre metadatafält som visas överst
-- på objektsidan. Konfig är unik per (tenant, objekttyp).
-- Idempotent (CREATE TABLE / CREATE INDEX ... IF NOT EXISTS) — säker att köra om.
CREATE TABLE IF NOT EXISTS object_header_configs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  object_type text NOT NULL,
  show_image boolean NOT NULL DEFAULT true,
  image_source varchar(20) NOT NULL DEFAULT 'vignette',
  show_map boolean NOT NULL DEFAULT true,
  field1_katalog_id varchar REFERENCES metadata_katalog(id) ON DELETE SET NULL,
  field2_katalog_id varchar REFERENCES metadata_katalog(id) ON DELETE SET NULL,
  field3_katalog_id varchar REFERENCES metadata_katalog(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_object_header_config_tenant_type
  ON object_header_configs (tenant_id, object_type);
CREATE INDEX IF NOT EXISTS idx_object_header_config_tenant
  ON object_header_configs (tenant_id);
