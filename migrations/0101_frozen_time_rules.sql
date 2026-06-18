-- Task #997 (Tidsmotor): Fryst viktat tidsregel-paket per genererad uppgift.
-- Snapshotas vid orderkoncept-expansion (hårda + mjuka regler med polaritet +
-- vikt). NULL = inga tidsregler gällde objektet → dagens fallback (schemalagt
-- datum) oförändrad. Expand-contract: nullable, ingen default, ingen back-fill.
-- Idempotent (ADD COLUMN IF NOT EXISTS) så att post-merge-replay är säker.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS frozen_time_rules jsonb;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_time_rules jsonb;
