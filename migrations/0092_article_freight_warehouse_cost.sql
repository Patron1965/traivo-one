-- 0092_article_freight_warehouse_cost.sql
-- GAP-104 / Task #938: prisuppbyggnad på artiklar. Lägg till fraktkostnad och
-- lagerkostnad så att självkostnad = inköp + frakt + lager kan beräknas.
-- Expand-contract: nullable → befintlig data + integrationer (Mobile/VRP/Fortnox)
-- är oförändrade. Idempotent: ADD COLUMN IF NOT EXISTS → säker att köra om.

ALTER TABLE articles ADD COLUMN IF NOT EXISTS freight_cost integer;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS warehouse_cost integer;
