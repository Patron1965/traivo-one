-- Idempotent: add delivery_time_metadata_field to order_concepts (Task #901, gap B8)
-- Holds the metadata_katalog.namn whose value drives an assignment's delivery time
-- at concept expansion (POST /api/order-concepts/:id/execute). NULL = unchanged
-- behavior (deliverySchedule / scheduledDate).
ALTER TABLE order_concepts
  ADD COLUMN IF NOT EXISTS delivery_time_metadata_field TEXT;
