-- Drop legacy bare-column GIN trigram indexes that block deploy validation.
--
-- Drizzle-kit's introspect-based diff (used by Replit's deploy validator)
-- loses the `gin_trgm_ops` operator class on bare-column GIN indexes such as
-- `CREATE INDEX ... ON customers USING gin (name gin_trgm_ops)`. The
-- generated DDL becomes `... USING gin ("name")` which fails with
-- "data type text has no default operator class for access method gin".
--
-- All ILIKE callsites have been switched to `LOWER(col) LIKE LOWER(q)`,
-- which uses the LOWER(...) expression GIN indexes from 0029/0030.
-- Those expression indexes are introspected correctly because the full
-- SQL expression is preserved in the diff.
--
-- This migration removes the bare-column indexes from any environment
-- that already has them. Safe and idempotent.

DROP INDEX IF EXISTS idx_customers_name_raw_trgm;
DROP INDEX IF EXISTS idx_objects_name_raw_trgm;
DROP INDEX IF EXISTS idx_objects_address_raw_trgm;
DROP INDEX IF EXISTS idx_objects_object_number_raw_trgm;
DROP INDEX IF EXISTS idx_work_orders_title_trgm;
