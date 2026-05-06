-- Task #388: quantity_mode på artiklar
-- Avgör om artikelns pris/tid multipliceras med objektets antal eller är fast (1 per uppdrag).
-- Idempotent: körs säkert i alla miljöer även där drizzle-kit push redan applicerat kolumnerna.

ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "quantity_mode" text NOT NULL DEFAULT 'use_object_quantity';

ALTER TABLE "order_concept_articles"
  ADD COLUMN IF NOT EXISTS "quantity_mode_override" text;

-- Backfill: säkerställ att alla befintliga rader har default-värdet (NOT NULL DEFAULT
-- ovan tar hand om det, men explicit UPDATE är säker även om kolumnen redan fanns).
UPDATE "articles"
  SET "quantity_mode" = 'use_object_quantity'
  WHERE "quantity_mode" IS NULL;
