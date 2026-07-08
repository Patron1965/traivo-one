-- Task #1205 (fält 54): läsbar matchningsorsak per uppgift — VARFÖR objektet
-- hakades på ett orderkoncept (vilka villkor som matchade), snapshotad vid
-- koncept-expansion. Idempotent (ADD COLUMN IF NOT EXISTS) och säker att replaya.
-- Se shared/schema.ts assignments.matchReason och work_orders.matchReason.

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS match_reason text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS match_reason text;
