-- Task #1329: Portal Surface Risks — DB-backed upload quota + orphan GC.
-- Tracks every file a portal customer has permanently confirmed (ACL-bound) in
-- object storage.  Used for:
--   1. Durable per-customer upload quota in POST /api/portal/field/confirm-photo
--      (survives restarts, works across multi-instance deployments).
--   2. Periodic confirmed-orphan GC that reclaims files not referenced in any
--      customer_change_requests.photos after the TTL (7 days).
-- All statements are idempotent (CREATE ... IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS portal_confirmed_uploads (
  id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   varchar NOT NULL REFERENCES tenants(id),
  customer_id varchar NOT NULL REFERENCES customers(id),
  object_path text NOT NULL,
  confirmed_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pcu_customer_idx    ON portal_confirmed_uploads (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS pcu_confirmed_at_idx ON portal_confirmed_uploads (confirmed_at);
