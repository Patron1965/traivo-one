-- Task #552: Kinab objekt-livscykel v2
-- Additiva, nullable kolumner — bakåtkompatibelt. Inga data-migrationer behövs.

ALTER TABLE "objects"
  ADD COLUMN IF NOT EXISTS "archived_by" varchar,
  ADD COLUMN IF NOT EXISTS "archived_reason" text;

ALTER TABLE "clusters"
  ADD COLUMN IF NOT EXISTS "dynamic_rules" jsonb,
  ADD COLUMN IF NOT EXISTS "dynamic_rules_last_applied_at" timestamp;
