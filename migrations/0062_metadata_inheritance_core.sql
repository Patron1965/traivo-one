-- Task #710: Metadata-arv & ändringslogg (kärnmodell), Session 7 §4 + §10.
-- Expand-contract: alla tillägg är nullable / har default så befintliga rader och
-- nedströmskonsumenter (import, VRP, mobil, Fortnox) är oförändrade. Alla satser
-- är idempotenta (ADD COLUMN IF NOT EXISTS) så post-merge-replay är säker.

-- Mjuk-radering av metadata-värden (eget värde döljs, eller "tombstone" som
-- negativt markerar ett borttaget ärvt fält på barnnivå).
ALTER TABLE metadata_varden
  ADD COLUMN IF NOT EXISTS raderad boolean NOT NULL DEFAULT false;
ALTER TABLE metadata_varden
  ADD COLUMN IF NOT EXISTS raderad_av varchar(100);
ALTER TABLE metadata_varden
  ADD COLUMN IF NOT EXISTS raderad_vid timestamp;

-- Per-objekt sorteringsordning för metadata-fält (ärvs nedåt, aldrig uppåt).
ALTER TABLE objects
  ADD COLUMN IF NOT EXISTS metadata_field_order jsonb;
