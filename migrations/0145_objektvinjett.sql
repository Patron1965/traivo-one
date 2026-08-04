-- Task #1366: Objektvinjett — "Visa i objektvinjett"-flagga på metadata_katalog
-- samt kundlogotyp-konfiguration på object_header_configs. Idempotent.

ALTER TABLE metadata_katalog
  ADD COLUMN IF NOT EXISTS visa_i_vinjett BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE object_header_configs
  ADD COLUMN IF NOT EXISTS show_logo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE object_header_configs
  ADD COLUMN IF NOT EXISTS logo_metadata_katalog_id VARCHAR REFERENCES metadata_katalog(id) ON DELETE SET NULL;
