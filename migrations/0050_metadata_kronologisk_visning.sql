-- Task #579: Kronologisk historik per metadatafält.
-- Lägger till flagga på metadata_katalog som signalerar att fältet ska visas
-- som en kronologisk tidslinje (Lyftkrok, Antal, Kontakt etc — PDF §14.3).
-- Lägger även till ett sammansatt index på metadata_historik för effektiv
-- "senast ändrad"-lookup per (objekt, definition).

ALTER TABLE "metadata_katalog"
  ADD COLUMN IF NOT EXISTS "kronologisk_visning" boolean NOT NULL DEFAULT false;

-- Backfill: aktivera tidslinje på de SYSTEMTYPER där PDF §14.3 + §3.2 kräver
-- historik. Begränsat till `is_system = true` så vi inte råkar flippa
-- tenant-egna fält som har samma namn av en slump.
UPDATE "metadata_katalog"
   SET "kronologisk_visning" = TRUE
 WHERE LOWER("namn") IN ('lyftkrok', 'antal', 'kontakt', 'status')
   AND COALESCE("is_system", FALSE) = TRUE
   AND "kronologisk_visning" = FALSE;

CREATE INDEX IF NOT EXISTS "idx_metadata_historik_objekt_katalog_tid"
  ON "metadata_historik" ("tenant_id", "objekt_id", "metadata_katalog_id", "andrad_vid" DESC);

-- Gör metadata_varden_id nullable + ON DELETE SET NULL så att radera-events
-- överlever cascade när själva värde-raden tas bort. Tidslinjen läses per
-- (objekt, katalog) — inte per varden-id — så pekaren är icke-kritisk.
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
    FROM pg_constraint
   WHERE conrelid = 'metadata_historik'::regclass
     AND contype = 'f'
     AND conkey = (
       SELECT array_agg(attnum)
         FROM pg_attribute
        WHERE attrelid = 'metadata_historik'::regclass
          AND attname = 'metadata_varden_id'
     );
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE metadata_historik DROP CONSTRAINT %I', fk_name);
  END IF;
END$$;

ALTER TABLE "metadata_historik"
  ALTER COLUMN "metadata_varden_id" DROP NOT NULL;

ALTER TABLE "metadata_historik"
  ADD CONSTRAINT "metadata_historik_metadata_varden_id_fkey"
  FOREIGN KEY ("metadata_varden_id") REFERENCES "metadata_varden"("id") ON DELETE SET NULL;
