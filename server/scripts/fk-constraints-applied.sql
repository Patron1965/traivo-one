-- Migration: Add foreign key constraints for referential integrity
-- Applied via: npm run db:push (Drizzle schema sync)
-- Date: 2026-03-22
-- Status: APPLIED

-- These constraints are defined in shared/schema.ts and applied via db:push.
-- This file documents what was applied for audit purposes.

-- 1. work_orders.cluster_id -> clusters.id (ON DELETE SET NULL)
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_cluster_id_fk
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)
  ON DELETE SET NULL;

-- 2. environmental_data.work_order_id -> work_orders.id (ON DELETE SET NULL)
ALTER TABLE environmental_data
  ADD CONSTRAINT environmental_data_work_order_id_fk
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id)
  ON DELETE SET NULL;

-- 3. environmental_data.vehicle_id -> vehicles.id (ON DELETE SET NULL)
ALTER TABLE environmental_data
  ADD CONSTRAINT environmental_data_vehicle_id_fk
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
  ON DELETE SET NULL;

-- 4. visit_confirmations.work_order_id -> work_orders.id (ON DELETE SET NULL)
ALTER TABLE visit_confirmations
  ADD CONSTRAINT visit_confirmations_work_order_id_fk
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id)
  ON DELETE SET NULL;

-- Pre-migration orphan cleanup (verified zero orphans before applying):
-- UPDATE work_orders SET cluster_id = NULL WHERE cluster_id NOT IN (SELECT id FROM clusters);
-- UPDATE environmental_data SET work_order_id = NULL WHERE work_order_id NOT IN (SELECT id FROM work_orders);
-- UPDATE environmental_data SET vehicle_id = NULL WHERE vehicle_id NOT IN (SELECT id FROM vehicles);
-- UPDATE visit_confirmations SET work_order_id = NULL WHERE work_order_id NOT IN (SELECT id FROM work_orders);
