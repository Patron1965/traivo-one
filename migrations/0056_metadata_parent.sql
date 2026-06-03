-- Task #662: Metadata-familjer via överordnat fält.
-- Nullable självreferens på metadata_katalog: ett underfält (t.ex. kontakt.fornamn)
-- pekar på sin förälder-katalogpost (kontakt). Punktnotation härleds i koden som
-- förälder.namn + "." + barn.namn; API:t tillåter endast en nivå djup.
--
-- db:push hanterar inte alltid självrefererande FK + index tillförlitligt i icke-
-- interaktivt läge, så detta replayas explicit. Alla satser är idempotenta
-- (IF NOT EXISTS / villkorad FK) — säkra att köra om i dev/prod/fresh-miljöer.
ALTER TABLE "metadata_katalog" ADD COLUMN IF NOT EXISTS "parent_metadata_id" varchar;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'metadata_katalog_parent_metadata_id_fkey'
      AND table_name = 'metadata_katalog'
  ) THEN
    ALTER TABLE "metadata_katalog"
      ADD CONSTRAINT "metadata_katalog_parent_metadata_id_fkey"
      FOREIGN KEY ("parent_metadata_id") REFERENCES "metadata_katalog"("id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_metadata_katalog_parent"
  ON "metadata_katalog" ("parent_metadata_id");
