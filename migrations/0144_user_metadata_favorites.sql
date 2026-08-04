-- Favoritmarkerade metadatatyper i typ-väljaren ("Lägg till metadata").
-- Per användare + tenant; favorites = jsonb-array av metadata_katalog.namn.
-- Idempotent (post-merge-replayable).
CREATE TABLE IF NOT EXISTS user_metadata_favorites (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id),
  tenant_id varchar NOT NULL REFERENCES tenants(id),
  favorites jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_metadata_favorites_user_tenant
  ON user_metadata_favorites (user_id, tenant_id);
