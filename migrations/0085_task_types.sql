-- 0085_task_types.sql
-- Per-tenant uppgiftstyp-register (Mats Uppdateringar 2026-06-12).
-- Driver Uppgiftstyp-filtret i Grovplaneringen. `key` är den normaliserade
-- nyckeln (se normalizeTaskType i server/grovplanering-grid.ts) och JOIN-punkten
-- mot work_orders.orderType — filtrering fungerar utan att peka om work_orders.
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS + seed via ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS task_types (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_types_tenant_key
  ON task_types (tenant_id, key);

-- Seed de 8 standardtyperna för varje befintlig tenant. ON CONFLICT gör
-- re-körning säker; nya tenants täcks av endpointens fallback tills de seedas.
INSERT INTO task_types (tenant_id, key, label, sort_order)
SELECT t.id, v.key, v.label, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('bok', 'BÖK', 1),
  ('rbk', 'RBK', 2),
  ('service', 'Service', 3),
  ('driftkontroll', 'Driftkontroll', 4),
  ('tvatt', 'Tvätt', 5),
  ('besiktning', 'Besiktning', 6),
  ('administration', 'Administration', 7),
  ('konsultation', 'Konsultation', 8)
) AS v(key, label, sort_order)
ON CONFLICT (tenant_id, key) DO NOTHING;
