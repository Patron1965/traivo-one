-- Task #1188: Uppgiftens tidslogg (händelselogg). Append-only per uppgift —
-- varje statusövergång och tidsstämpel (önskad→planerad→verklig, plus studsar
-- grov↔fin och ombokningar) skrivs som en NY rad, aldrig överskriven.
-- Fristående från audit_logs och additiv/expand-contract: inga befintliga
-- kolumner rörs. Idempotent (IF NOT EXISTS) så post-merge-replay kan köras om.

CREATE TABLE IF NOT EXISTS task_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  work_order_id varchar NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  time_kind text,
  from_status text,
  to_status text,
  actor_type text,
  actor_id varchar,
  detail jsonb DEFAULT '{}'::jsonb,
  occurred_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_events_work_order ON task_events (work_order_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_task_events_tenant ON task_events (tenant_id);
