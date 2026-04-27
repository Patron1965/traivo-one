-- Performance indexes for dashboard / list / search workloads (Task #278).
-- All statements are idempotent (CREATE ... IF NOT EXISTS) and safe to re-apply.
-- Applied automatically via scripts/post-merge.sh.

-- Trigram extension (already enabled by 0029/0030, kept for safety).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Trigram GIN indexes on RAW columns so raw `ILIKE %x%` matches
-- (existing 0029/0030 indexes use LOWER(...) and only help when
-- the query is rewritten to LOWER(...) LIKE LOWER(...)).
-- pg_trgm's gin_trgm_ops handles ILIKE directly on the raw column.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_work_orders_title_trgm
  ON work_orders USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_objects_name_raw_trgm
  ON objects USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_objects_address_raw_trgm
  ON objects USING gin (address gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_objects_object_number_raw_trgm
  ON objects USING gin (object_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_name_raw_trgm
  ON customers USING gin (name gin_trgm_ops);

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
