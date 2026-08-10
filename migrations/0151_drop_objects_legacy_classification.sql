-- Task #1486 (contract-fas): riv legacy-klassificeringskolumnerna på objects.
-- Metadata (metadata_katalog-fälten "Objekttyp"/"Anläggningstyp" i området
-- Klassificering) är enda källan sedan expand-fasen (#1484) och backfill är
-- verifierad. article_id och last_service_date är konstaterat döda (0 icke-NULL
-- i både dev och prod). Idempotent — säker att köra flera gånger.
ALTER TABLE objects DROP COLUMN IF EXISTS object_type;
ALTER TABLE objects DROP COLUMN IF EXISTS hierarchy_level;
ALTER TABLE objects DROP COLUMN IF EXISTS object_level;
ALTER TABLE objects DROP COLUMN IF EXISTS article_id;
ALTER TABLE objects DROP COLUMN IF EXISTS last_service_date;
