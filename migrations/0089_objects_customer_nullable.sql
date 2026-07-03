-- Task #925: Import-wizard kund-agnostisk.
-- ADR v3: objekt är kund-neutrala. `objects.customer_id` är legacy ("under
-- avveckling") — auktoritativ kundkoppling sker via `object_payers` /
-- `work_orders.customer_id`. Gör kolumnen nullable (expand-contract) så den
-- kund-agnostiska 3-stegs import-wizarden kan skapa objekt utan kundbindning.
--
-- Idempotent OCH säker mot kontraktsfasen: migration 0114 (samt `db:push` mot
-- ADR v3-schemat, som saknar kolumnen) DROPPAR `objects.customer_id` helt. I
-- post-merge-replayn kör `db:push` FÖRE denna fil, så kolumnen kan redan vara
-- borta. Ett ovillkorligt `DROP NOT NULL` på en saknad kolumn är ett HÅRT fel
-- (till skillnad från `ADD COLUMN IF NOT EXISTS`) → hela replayn bröts. Guarda
-- därför på kolumnens existens så satsen blir en ren no-op när den är borttagen.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'objects'
      AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE "objects" ALTER COLUMN "customer_id" DROP NOT NULL;
  END IF;
END $$;
