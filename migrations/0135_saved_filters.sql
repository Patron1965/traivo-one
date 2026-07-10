-- Task #1240: Delad filtermotor — sparade/delade/roll-scopade filter.
-- Idempotent (post-merge-replayable): IF NOT EXISTS överallt.
CREATE TABLE IF NOT EXISTS saved_filters (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  user_id varchar NOT NULL,
  scope text NOT NULL,
  name text NOT NULL,
  definition jsonb NOT NULL,
  is_shared boolean NOT NULL DEFAULT false,
  roles text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_tenant_scope ON saved_filters(tenant_id, scope);
CREATE INDEX IF NOT EXISTS idx_saved_filters_tenant_user ON saved_filters(tenant_id, user_id);
