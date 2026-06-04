-- Migration: add invoice_brake column to order_concepts
-- Expand-contract: nullable=false with default, safe for existing rows.
ALTER TABLE order_concepts
  ADD COLUMN IF NOT EXISTS invoice_brake boolean NOT NULL DEFAULT false;
