-- Composite (tenant_id, customer_id) indexes for customer aggregate joins.
-- These are standard btree indexes — no extension required.
--
-- NOTE: Earlier revisions of this file also created pg_trgm-based GIN
-- indexes for case-insensitive substring search. Those have been removed
-- because Replit's deploy validator introspects them from the dev DB and
-- tries to recreate them in production without first installing the
-- pg_trgm extension, which fails with
-- "operator class \"gin_trgm_ops\" does not exist for access method \"gin\"".
-- Migration 0033 drops any leftover trigram indexes from dev environments
-- that already had them.

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_customer
  ON work_orders (tenant_id, customer_id);
-- NOTE: idx_clusters_tenant_root_customer removed — the clusters table was
-- dropped in migration 0129 (Etapp 5, objektmodell-rensning). Recreating an
-- index on a non-existent table breaks the post-merge migration replay.
