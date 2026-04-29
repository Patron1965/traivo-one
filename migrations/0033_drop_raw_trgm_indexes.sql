-- Drop pg_trgm-based trigram indexes that block deploy validation.
--
-- Replit's deploy validator does its own schema introspection of the dev
-- database and generates the migration to apply against production. When
-- the dev DB has GIN trigram indexes (either bare-column or LOWER(...) ),
-- the validator emits CREATE INDEX statements that require the pg_trgm
-- extension to be installed in production — which it usually is not on
-- managed Postgres providers, causing
-- "operator class \"gin_trgm_ops\" does not exist for access method \"gin\"".
--
-- All ILIKE callsites use LOWER(col) LIKE LOWER(q) which still works
-- correctly without these indexes (just slower on very large tables).
--
-- Safe and idempotent.

-- Bare-column trigram indexes (legacy)
DROP INDEX IF EXISTS idx_customers_name_raw_trgm;
DROP INDEX IF EXISTS idx_objects_name_raw_trgm;
DROP INDEX IF EXISTS idx_objects_address_raw_trgm;
DROP INDEX IF EXISTS idx_objects_object_number_raw_trgm;
DROP INDEX IF EXISTS idx_work_orders_title_trgm;

-- LOWER(...) expression trigram indexes (from old 0029/0030)
DROP INDEX IF EXISTS idx_customers_name_trgm;
DROP INDEX IF EXISTS idx_customers_customer_number_trgm;
DROP INDEX IF EXISTS idx_customers_email_trgm;
DROP INDEX IF EXISTS idx_customers_city_trgm;
DROP INDEX IF EXISTS idx_objects_name_trgm;
DROP INDEX IF EXISTS idx_objects_object_number_trgm;
DROP INDEX IF EXISTS idx_objects_address_trgm;
DROP INDEX IF EXISTS idx_objects_city_trgm;
