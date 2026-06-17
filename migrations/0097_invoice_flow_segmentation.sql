-- Task #970: Metadatastyrd fakturaflödeslogik ("Faktura från toppen")
-- Fryst billing-segment på work_orders som förfinar konsoliderings-grupperingen
-- ovanpå frozen recipient/customer. NULL = ingen split = exakt dagens beteende.
-- customer_invoices speglar segmentet för audit/visning. Alla idempotenta.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS billing_segment_key text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS billing_break_object_id varchar;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS billing_grouping_field_name text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS billing_grouping_value text;

ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS billing_segment_key text;
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS billing_break_object_id varchar;
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS billing_grouping_field_name text;
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS billing_grouping_value text;

CREATE INDEX IF NOT EXISTS idx_work_orders_billing_segment
  ON work_orders (tenant_id, billing_segment_key);
