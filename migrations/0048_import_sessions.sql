-- Task #578: Tre-stegs import-wizard
-- Sessions-bunden interimnummer-mapping som spänner över alla tre stegen
-- (Organisation → Butiker → Fysiska objekt). Steg 2/3 kan referera steg 1:s
-- interim-IDn även innan permanenta objektnummer satts.

CREATE TABLE IF NOT EXISTS import_sessions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  customer_id varchar NOT NULL REFERENCES customers(id),
  status text DEFAULT 'in_progress' NOT NULL,
  step_completed integer DEFAULT 0 NOT NULL,
  interim_map jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by varchar,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  CONSTRAINT import_sessions_step_check CHECK (step_completed BETWEEN 0 AND 3),
  CONSTRAINT import_sessions_status_check CHECK (status IN ('in_progress', 'completed', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS idx_import_sessions_tenant ON import_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_import_sessions_tenant_status ON import_sessions(tenant_id, status);
