-- Task #577: Standard-metadatakatalog med områden och dropdown-val (PDF §7 + §14)
-- Lägger till områdes-, sortnummer- och dubblett-fält på metadata_katalog.
ALTER TABLE "metadata_katalog" ADD COLUMN IF NOT EXISTS "area" text;
ALTER TABLE "metadata_katalog" ADD COLUMN IF NOT EXISTS "display_number" integer;
ALTER TABLE "metadata_katalog" ADD COLUMN IF NOT EXISTS "allow_duplicates" boolean NOT NULL DEFAULT false;
