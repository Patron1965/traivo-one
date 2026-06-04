-- Idempotent: add customer_metadata_field to order_concepts (Task 748)
-- Holds the metadata fieldKey that identifies the customer in FROM_METADATA mode.
ALTER TABLE order_concepts
  ADD COLUMN IF NOT EXISTS customer_metadata_field TEXT;
