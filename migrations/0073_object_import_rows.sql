-- Import 2.0 — persistent per-rad-livscykel (spec §6.1 ImportRow).
-- Additivt, idempotent. Hänger på object_import_sessions (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS object_import_rows (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id varchar NOT NULL REFERENCES object_import_sessions(id) ON DELETE CASCADE,
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  row_number integer NOT NULL,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  validation_msgs jsonb NOT NULL DEFAULT '[]'::jsonb,
  object_id varchar,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_object_import_rows_session
  ON object_import_rows (session_id);
CREATE INDEX IF NOT EXISTS idx_object_import_rows_tenant
  ON object_import_rows (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_object_import_rows_session_row
  ON object_import_rows (session_id, row_number);
