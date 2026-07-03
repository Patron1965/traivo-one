-- Tidskod fryst per uppgift vid orderkoncept-expansion (grunden för finplanering + framtida
-- lönerapport). Idempotent (ADD COLUMN IF NOT EXISTS) och säker att replaya.
-- Se shared/schema.ts assignments.frozenTimeCode och work_orders.frozenTimeCode.

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS frozen_time_code text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_time_code text;
