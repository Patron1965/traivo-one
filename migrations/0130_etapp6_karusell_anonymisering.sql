-- Task #1218 (Etapp 6): karusell-flagga + GDPR-anonymisering.
-- Idempotent (ADD COLUMN IF NOT EXISTS) — säker att köra flera gånger.

-- "Visas i karusell": styr om katalogfältet visas i metadata-karusellen på
-- objekt-360/mobil/export. Default true = back-compat (allt syns).
ALTER TABLE metadata_katalog
  ADD COLUMN IF NOT EXISTS visas_i_karusell BOOLEAN NOT NULL DEFAULT TRUE;

-- Anonymiserings-spår: VEM/NÄR — aldrig VAD (värdefälten nollas oåterkalleligt
-- när status='anonymiserad').
ALTER TABLE metadata_varden
  ADD COLUMN IF NOT EXISTS anonymiserad_av VARCHAR(100);
ALTER TABLE metadata_varden
  ADD COLUMN IF NOT EXISTS anonymiserad_vid TIMESTAMP;
