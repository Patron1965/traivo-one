-- Task #1369: Uppgifters ursprung (källtyp) — stämplas vid skapandet, ändras aldrig.
-- NULL = historisk rad (backfylls medvetet INTE; visas som "Okänd").
-- Idempotent (IF NOT EXISTS) — säker att köra flera gånger (post-merge replay).
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS source_type text;
