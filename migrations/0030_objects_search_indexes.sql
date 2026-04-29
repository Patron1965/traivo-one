-- This migration previously created pg_trgm-based GIN indexes on objects
-- (name/object_number/address/city) for fast substring search.
--
-- It has been emptied because Replit's deploy validator introspects those
-- indexes from the dev DB and tries to recreate them in production without
-- installing the pg_trgm extension first, which fails with
-- "operator class \"gin_trgm_ops\" does not exist for access method \"gin\"".
--
-- Substring search still works correctly via the existing
-- LOWER(col) LIKE LOWER(q) callsites in storage.ts — just without the
-- trigram acceleration. Migration 0033 drops any leftover trigram indexes
-- from environments that already had them.

-- (intentionally empty)
SELECT 1;
