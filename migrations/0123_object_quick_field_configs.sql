-- Objektvy 360 Fas 1 (P1): per-objekt snabbfälts-konfiguration.
-- Upp till tre inpekade metadatafält som visas som "snabbfält" högst upp på ett
-- ENSKILT objekt. Skiljer sig från object_header_configs (per objekttyp): denna
-- gäller ett objekt och ärvs NEDÅT genom den primära förälderkedjan
-- (närmast-vinner), åsidosättbar på lägre nivå — samma arvsmodell som metadata.
-- En rad = objektet definierar sin egen konfig (även tom = medvetet inga
-- snabbfält här); ingen rad = ärv från närmaste förfader annars objekttyp-default.
-- objectId kaskad-raderas med objektet (ren presentationskonfig, ingen affärsdata).
-- Idempotent (CREATE TABLE / CREATE INDEX ... IF NOT EXISTS) — säker att köra om.
CREATE TABLE IF NOT EXISTS object_quick_field_configs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  object_id varchar NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  field1_katalog_id varchar REFERENCES metadata_katalog(id) ON DELETE SET NULL,
  field2_katalog_id varchar REFERENCES metadata_katalog(id) ON DELETE SET NULL,
  field3_katalog_id varchar REFERENCES metadata_katalog(id) ON DELETE SET NULL,
  updated_by varchar,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_object_quick_field_config_object
  ON object_quick_field_configs (tenant_id, object_id);
CREATE INDEX IF NOT EXISTS idx_object_quick_field_config_tenant
  ON object_quick_field_configs (tenant_id);
