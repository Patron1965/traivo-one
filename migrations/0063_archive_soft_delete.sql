-- Task #716: Arkivering istället för permanent radering.
-- Lägger till soft-delete-kolumner (deleted_at + archived_by + archived_reason) på
-- object_images, object_contacts och metadata_katalog. Speglar samma mönster som
-- redan finns på objects/work_orders (deleted_at IS NOT NULL = arkiverad).
--
-- Expand-contract: alla kolumner är nullable utan default → bakåtkompatibelt med
-- mobil/import/Fortnox. Alla satser är idempotenta (ADD COLUMN IF NOT EXISTS) så
-- att de är säkra att köra om i dev/prod/fresh-miljöer.

-- object_images/object_contacts droppades i migration 0129 (Etapp 5).
-- Guarda så replay blir no-op när tabellerna är borta.
DO $$ BEGIN
  IF to_regclass('public.object_images') IS NOT NULL THEN
    ALTER TABLE "object_images"
      ADD COLUMN IF NOT EXISTS "deleted_at" timestamp,
      ADD COLUMN IF NOT EXISTS "archived_by" varchar,
      ADD COLUMN IF NOT EXISTS "archived_reason" text;
  END IF;
  IF to_regclass('public.object_contacts') IS NOT NULL THEN
    ALTER TABLE "object_contacts"
      ADD COLUMN IF NOT EXISTS "deleted_at" timestamp,
      ADD COLUMN IF NOT EXISTS "archived_by" varchar,
      ADD COLUMN IF NOT EXISTS "archived_reason" text;
  END IF;
END $$;

ALTER TABLE "metadata_katalog"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "archived_by" varchar,
  ADD COLUMN IF NOT EXISTS "archived_reason" text;
