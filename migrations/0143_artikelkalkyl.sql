-- Task #1350: Artikelkalkyl — kostnadskalkyl → självkostnad → separat priskalkyl.
-- Idempotent (post-merge-replayable). Additivt (expand-contract): alla kolumner
-- nullable så befintliga artiklar behåller legacy-beteendet tills kalkylen väljs.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS packaging_cost integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS environmental_fee integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS hourly_cost integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS other_cost integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS costing_method text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS pricing_method text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS desired_margin_percent real;
