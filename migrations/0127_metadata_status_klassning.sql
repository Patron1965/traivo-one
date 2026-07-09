-- Task #1213 Etapp 1: Metadatakärnan — statusmodell + inert katalogegenskap
-- + konvertering av metadata_historik till fullvärdiga arkiverade poster.
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS och
-- backfill/konvertering skyddas med WHERE-villkor resp. unik provenance-kolumn.

-- 1) Logisk status på metadata_varden: aktiv | arkiverad | anonymiserad.
ALTER TABLE metadata_varden ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'aktiv';
ALTER TABLE metadata_varden ADD COLUMN IF NOT EXISTS arkiverad_av varchar(100);
ALTER TABLE metadata_varden ADD COLUMN IF NOT EXISTS arkiverad_vid timestamp;
-- Provenance för historik-konverteringen (unik ⇒ idempotent INSERT ... NOT EXISTS).
ALTER TABLE metadata_varden ADD COLUMN IF NOT EXISTS konverterad_fran_historik_id varchar;

CREATE INDEX IF NOT EXISTS idx_metadata_varden_status ON metadata_varden (objekt_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_metadata_varden_konv_historik ON metadata_varden (konverterad_fran_historik_id);

-- 2) Inert katalogegenskap: tillåt uppdatering uppåt/syskon (v1 = avstängd).
ALTER TABLE metadata_katalog ADD COLUMN IF NOT EXISTS tillat_uppdatering_uppat boolean NOT NULL DEFAULT false;

-- 3) Backfill: mjuk-raderade rader MED eget värde blir logiskt 'arkiverad'.
--    (Tombstones utan eget värde behåller status='aktiv' + raderad=TRUE som
--    teknisk negativ-markering för brutet arv.)
UPDATE metadata_varden
SET status = 'arkiverad',
    arkiverad_av = COALESCE(arkiverad_av, raderad_av),
    arkiverad_vid = COALESCE(arkiverad_vid, raderad_vid, updated_at)
WHERE raderad = TRUE
  AND status = 'aktiv'
  AND (varde_string IS NOT NULL OR varde_integer IS NOT NULL OR varde_decimal IS NOT NULL
       OR varde_boolean IS NOT NULL OR varde_datetime IS NOT NULL OR varde_json IS NOT NULL
       OR varde_referens IS NOT NULL);

-- 4) Konvertera befintlig historiklogg till fullvärdiga arkiverade poster.
--    En historikrad med gammalt_varde ≠ NULL representerar ett tidigare gällande
--    värde som ersattes/togs bort — det blir en arkiverad metadata_varden-post.
--    Värdet lagras som varde_string (historiken sparar visningssträngar).
--    arvs_nedat=FALSE + status='arkiverad' ⇒ deltar aldrig i arv/visning.
--    Idempotent via konverterad_fran_historik_id (unik) + NOT EXISTS.
INSERT INTO metadata_varden (
  tenant_id, objekt_id, metadata_katalog_id, varde_string,
  arvs_nedat, stoppa_vidare_arvning, niva_las,
  skapad_av, uppdaterad_av, metod,
  status, arkiverad_av, arkiverad_vid, konverterad_fran_historik_id,
  created_at, updated_at
)
SELECT
  h.tenant_id, h.objekt_id, h.metadata_katalog_id, h.gammalt_varde,
  FALSE, FALSE, FALSE,
  h.andrad_av, h.andrad_av, 'historik-konvertering',
  'arkiverad', h.andrad_av, h.andrad_vid, h.id,
  h.andrad_vid, h.andrad_vid
FROM metadata_historik h
WHERE h.gammalt_varde IS NOT NULL
  AND h.objekt_id IS NOT NULL
  AND h.metadata_katalog_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM metadata_varden mv
    WHERE mv.konverterad_fran_historik_id = h.id
  );
