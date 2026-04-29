-- Performance indexes for dashboard / list / search workloads (Task #278).
-- All statements are idempotent (CREATE ... IF NOT EXISTS) and safe to re-apply.
-- Applied automatically via scripts/post-merge.sh.

-- NOTE: pg_trgm extension creation removed — see migration 0033 for context.
-- The remaining indexes in this file (jsonb GIN and expression indexes for
-- ->>'key' lookups) do NOT require pg_trgm.

-- ============================================================
-- NOTE on raw-column GIN trigram indexes:
-- Earlier revisions of this file created plain GIN indexes on raw
-- text columns (e.g. `gin (name gin_trgm_ops)`). Those bare-column
-- GIN indexes are introspected by drizzle-kit without the operator
-- class metadata, so the deploy validator generates broken DDL
-- (`gin (name)`) and migrations fail with
-- "data type text has no default operator class for access method gin".
--
-- The LOWER(...) expression GIN indexes from 0029/0030 are
-- introspected correctly because the full SQL expression is
-- preserved. All raw-ILIKE callsites have been switched to
-- `LOWER(col) LIKE LOWER(q)` so they hit the existing expression
-- indexes — see server/routes/customerRoutes.ts.
--
-- The drop block in migration 0033 removes the legacy bare-column
-- indexes from any environment that already has them.
-- ============================================================

-- ============================================================
-- Expression indexes for tenant-scoped JSONB ->>'key' lookups.
-- Plain GIN(jsonb) does NOT accelerate ->> equality predicates;
-- expression indexes on the specific keys do.
-- Kept the GIN(metadata) indexes too because they help @> containment
-- queries that may exist elsewhere.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_work_orders_metadata_gin
  ON work_orders USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_audit_logs_metadata_gin
  ON audit_logs USING gin (metadata);

-- Specific expression index for the modus-id lookup pattern in storage.ts.
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_metadata_modusid
  ON work_orders (tenant_id, (metadata->>'modusId'));

-- Specific expression index for batch-id lookups in audit logs (importRoutes
-- and enrich-modus-restore use ->>'batchId').
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_metadata_batchid
  ON audit_logs (tenant_id, (metadata->>'batchId'));
