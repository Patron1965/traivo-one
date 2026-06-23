-- Task #1037 — Slottids-register (Tids- & geografimotor, datafundament)
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS. Additivt — påverkar inga befintliga
-- flöden (import/VRP/Fortnox/mobil). Storheter (ordervärde/kostnad/produktionstid)
-- återanvänds från assignments (cachedValue/cachedCost/estimatedDuration) och läggs
-- INTE till här.

CREATE TABLE IF NOT EXISTS slot_times (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  assignment_id varchar REFERENCES assignments(id) ON DELETE CASCADE,
  assignment_group_key text,
  window_start timestamp NOT NULL,
  window_end timestamp NOT NULL,
  slot_type text NOT NULL,
  status text NOT NULL DEFAULT 'forslag',
  rank integer NOT NULL DEFAULT 0,
  score real,
  source text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  CONSTRAINT chk_slot_times_target CHECK (assignment_id IS NOT NULL OR assignment_group_key IS NOT NULL),
  CONSTRAINT chk_slot_times_window_order CHECK (window_end >= window_start)
);

CREATE INDEX IF NOT EXISTS idx_slot_times_tenant ON slot_times (tenant_id);
CREATE INDEX IF NOT EXISTS idx_slot_times_tenant_assignment ON slot_times (tenant_id, assignment_id);
CREATE INDEX IF NOT EXISTS idx_slot_times_tenant_group ON slot_times (tenant_id, assignment_group_key);
CREATE INDEX IF NOT EXISTS idx_slot_times_tenant_status ON slot_times (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_slot_times_tenant_window_start ON slot_times (tenant_id, window_start);
CREATE INDEX IF NOT EXISTS idx_slot_times_tenant_deleted ON slot_times (tenant_id, deleted_at);
