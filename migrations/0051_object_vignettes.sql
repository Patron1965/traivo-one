-- Task #580: Vinjetbild per objekt med versionshistorik (PDF §14.5).
-- Soft-supersede: max EN aktuell vinjetbild per objekt (supersededAt IS NULL).
-- Historiska bilder behålls för slitage-spårning.

CREATE TABLE IF NOT EXISTS object_vignettes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  object_id varchar NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  uploaded_by varchar REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at timestamp NOT NULL DEFAULT now(),
  superseded_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_object_vignettes_tenant_object_uploaded
  ON object_vignettes (tenant_id, object_id, uploaded_at DESC);

-- Hård garanti: max EN aktiv vinjetbild per (tenant, object). Vid race
-- mellan två samtidiga byten kommer den andra INSERTen att failas och
-- transaktionen rullas tillbaka — call:are får 409/retry.
CREATE UNIQUE INDEX IF NOT EXISTS idx_object_vignettes_active_unique
  ON object_vignettes (tenant_id, object_id)
  WHERE superseded_at IS NULL;
