-- Task #577: Standard-metadatakatalog med områden och dropdown-val (PDF §7 + §14)
-- Lägger till områdes-, sortnummer- och dubblett-fält på metadata_katalog samt
-- backfillar redan-existerande standardtyper för befintliga tenants.

ALTER TABLE "metadata_katalog" ADD COLUMN IF NOT EXISTS "area" text;
ALTER TABLE "metadata_katalog" ADD COLUMN IF NOT EXISTS "display_number" integer;
ALTER TABLE "metadata_katalog" ADD COLUMN IF NOT EXISTS "allow_duplicates" boolean NOT NULL DEFAULT false;

-- Backfill: sätt area + display_number på rader där standardnamnet redan finns
-- (idempotent, bara om kolumnerna ännu är NULL — rör inte tenant-anpassningar).
UPDATE "metadata_katalog" SET "area" = 'grunduppgifter', "display_number" = COALESCE("display_number", 1)
  WHERE LOWER("namn") = 'kontakt' AND "area" IS NULL;
UPDATE "metadata_katalog" SET "area" = 'grunduppgifter', "display_number" = COALESCE("display_number", 3)
  WHERE LOWER("namn") = 'vinjetbild' AND "area" IS NULL;
UPDATE "metadata_katalog" SET "area" = 'produktion', "display_number" = COALESCE("display_number", 6)
  WHERE LOWER("namn") = 'typ' AND "area" IS NULL;
UPDATE "metadata_katalog" SET "area" = 'produktion', "display_number" = COALESCE("display_number", 9)
  WHERE LOWER("namn") = 'antal' AND "area" IS NULL;
UPDATE "metadata_katalog" SET "area" = 'produktion', "display_number" = COALESCE("display_number", 12), "allow_duplicates" = TRUE
  WHERE LOWER("namn") = 'yta' AND "area" IS NULL;
UPDATE "metadata_katalog" SET "area" = 'produktion', "display_number" = COALESCE("display_number", 15)
  WHERE LOWER("namn") = 'storlek' AND "area" IS NULL;
UPDATE "metadata_katalog" SET "area" = 'produktion', "display_number" = COALESCE("display_number", 18)
  WHERE LOWER("namn") = 'lyftkrok' AND "area" IS NULL;
UPDATE "metadata_katalog" SET "area" = 'produktion', "display_number" = COALESCE("display_number", 21)
  WHERE LOWER("namn") IN ('tömningsdag','tomningsdag') AND "area" IS NULL;
UPDATE "metadata_katalog" SET "area" = 'produktion', "display_number" = COALESCE("display_number", 24)
  WHERE LOWER("namn") = 'färg' AND "area" IS NULL;
UPDATE "metadata_katalog" SET "area" = 'grunduppgifter', "display_number" = COALESCE("display_number", 1000)
  WHERE LOWER("namn") = 'objektnamn' AND "area" IS NULL;
