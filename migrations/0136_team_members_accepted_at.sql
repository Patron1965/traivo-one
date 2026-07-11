-- Idempotent: add accepted_at to team_members.
-- NULL = pending invite, non-NULL = confirmed membership.
-- Existing rows are treated as accepted (backfilled to created_at) to avoid
-- breaking live teams that were created before this migration.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
UPDATE team_members SET accepted_at = created_at WHERE accepted_at IS NULL;
