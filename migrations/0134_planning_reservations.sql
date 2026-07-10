-- Task #1238: Planeringsreservationer ("reservtid") — reserverad tidslucka i
-- 168h-vyn. INTE en riktig uppgift (skapar aldrig work_orders/personal_tasks-rader).
CREATE TABLE IF NOT EXISTS planning_reservations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL REFERENCES tenants(id),
  weekly_plan_id VARCHAR NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  team_id VARCHAR REFERENCES teams(id),
  resource_id VARCHAR REFERENCES resources(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  planned_date DATE,
  start_at TIMESTAMP NOT NULL,
  end_at TIMESTAMP NOT NULL,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planning_reservations_tenant ON planning_reservations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_planning_reservations_plan ON planning_reservations(weekly_plan_id);
CREATE INDEX IF NOT EXISTS idx_planning_reservations_resource ON planning_reservations(resource_id);
CREATE INDEX IF NOT EXISTS idx_planning_reservations_plan_date ON planning_reservations(weekly_plan_id, planned_date);
