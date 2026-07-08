-- Systemlåsta metadatafält (kanonisk geografimodell: Standardadress + Fördjupad position).
-- Ny flagga metadata_katalog.systemlast: låser fältets STRUKTUR (namn/beteckning/datatyp/
-- sortOrder/parent kan ej ändras, fältet kan ej raderas) men tillåter VÄRDE-writes per objekt.
-- Skiljt från is_system (som blockerar värde-writes). Idempotent (expand-contract) — safe re-run.
ALTER TABLE metadata_katalog ADD COLUMN IF NOT EXISTS systemlast boolean NOT NULL DEFAULT false;
