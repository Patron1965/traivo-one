-- Task #1043 — Planerarens beslut på motorns föreslagna slottider.
-- Additivt/expand-contract: nullable kolumner, påverkar inga befintliga flöden
-- (motorkörning, läs-vyn, import/VRP/Fortnox/mobil). Idempotent — re-runs safe.
--
-- planner_decision: NULL = obeslutat, 'accepterad' = förs vidare till
-- finplanering/ruttoptimering, 'avvisad' = avfärdat av planeraren.

ALTER TABLE slot_times ADD COLUMN IF NOT EXISTS planner_decision text;
ALTER TABLE slot_times ADD COLUMN IF NOT EXISTS decided_at timestamp;
ALTER TABLE slot_times ADD COLUMN IF NOT EXISTS decided_by varchar;

CREATE INDEX IF NOT EXISTS idx_slot_times_tenant_decision ON slot_times (tenant_id, planner_decision);
