-- Task #1236: Verklig tid & automatiskt avslut.
-- Idempotent (ADD COLUMN IF NOT EXISTS) — säker att köra flera gånger.

-- work_orders: klump-fördelning av verklig/registrerad tid + manuellt lås
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS actual_time_group_key TEXT;
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS actual_duration_manual BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_work_orders_actual_time_group ON work_orders(actual_time_group_key);
