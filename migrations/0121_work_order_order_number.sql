-- Snabborder (light ordergivare): löpande läsbart ordernummer per tenant på work_orders.
-- Format "SO-<n>" (start 1001). Nullable (expand-contract) — endast snabborder-flödet
-- sätter värde (server-mintat under advisory-lås), övriga WO lämnas NULL.
-- Partiellt unikt index per tenant (WHERE order_number IS NOT NULL) så att alla WO utan
-- nummer inte kolliderar. Idempotent så post-merge-replay kan köras om.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS order_number text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_tenant_order_number
  ON work_orders (tenant_id, order_number)
  WHERE order_number IS NOT NULL;
