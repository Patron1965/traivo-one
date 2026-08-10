-- Task #1459: explicit grupp-nyckel för sammanhörande flervärdesrader
-- (kontaktpersonens Namn/Titel/Telefon/E-post). Rader som hör till samma
-- person delar en gemensam nyckel så att parningen är deterministisk även
-- när ett saknat underfält kompletteras i efterhand.
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfill endast där nyckel saknas.

ALTER TABLE metadata_varden ADD COLUMN IF NOT EXISTS grupp_nyckel varchar(64);

CREATE INDEX IF NOT EXISTS idx_metadata_varden_grupp_nyckel
  ON metadata_varden (objekt_id, grupp_nyckel)
  WHERE grupp_nyckel IS NOT NULL;

-- Backfill: para befintliga kontakt-underfält med SAMMA regel som läsvägen
-- använt hittills (kronologisk ordning per katalogfält: created_at, sedan id;
-- endast aktiva, ej mjuk-raderade rader) och stämpla en deterministisk
-- gemensam nyckel per (objekt, index). Endast rader utan nyckel berörs, så
-- re-körning är säker och nyskrivna (redan grupperade) rader rörs aldrig.
WITH kontakt_rows AS (
  SELECT
    mv.id,
    mv.objekt_id,
    ROW_NUMBER() OVER (
      PARTITION BY mv.objekt_id, mv.metadata_katalog_id
      ORDER BY mv.created_at, mv.id
    ) AS rn
  FROM metadata_varden mv
  JOIN metadata_katalog mk ON mk.id = mv.metadata_katalog_id
  WHERE mk.area = 'kontakt'
    AND mk.datatyp <> 'rubrik'
    AND mk.deleted_at IS NULL
    AND mv.objekt_id IS NOT NULL
    AND mv.grupp_nyckel IS NULL
    AND COALESCE(mv.raderad, FALSE) = FALSE
    AND mv.status = 'aktiv'
)
UPDATE metadata_varden mv
SET grupp_nyckel = 'kontakt-' || md5(kr.objekt_id || ':' || kr.rn::text)
FROM kontakt_rows kr
WHERE mv.id = kr.id;
