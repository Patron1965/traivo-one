-- Task #578: koppla import_batches till import-wizard-sessioner.
ALTER TABLE import_batches
  ADD COLUMN IF NOT EXISTS session_id varchar
    REFERENCES import_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_import_batches_session
  ON import_batches(session_id);
