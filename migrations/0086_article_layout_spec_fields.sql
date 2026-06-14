-- 0086_article_layout_spec_fields.sql
-- "Ny artikel"-layoutspec: nya artikelkonfigurationsfält för helsidesvyn
-- (Lager & Inköp, Pris & Ekonomi-tillägg, Informationskrav, Utförarkategori).
-- Expand-contract: alla kolumner nullable/default så befintlig data och
-- integrationer (Mobile/VRP/Fortnox) är oförändrade.
-- Idempotent: ADD COLUMN IF NOT EXISTS → säker att köra om.

ALTER TABLE articles ADD COLUMN IF NOT EXISTS purchase_price integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS standard_cost integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS material_cost integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS markup_percent real;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS charge_model text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS travel_time integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS default_supplier_id varchar REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reorder_point integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS safety_stock integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS min_order_quantity integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS stock_locations jsonb DEFAULT '[]'::jsonb;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS information_requirements jsonb DEFAULT '[]'::jsonb;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS performer_category text;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS competency_requirements text[] DEFAULT '{}';
