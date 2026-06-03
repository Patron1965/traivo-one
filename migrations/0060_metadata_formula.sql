-- Task #666: Beräknade metadatafält (formel).
-- Lägger till markering + formel på metadata_katalog. Expand-contract: nullable/
-- default så befintliga rader och integrationer (import, VRP, mobile) är opåverkade.
-- Idempotent (ADD COLUMN IF NOT EXISTS) så re-körning är säker.
ALTER TABLE metadata_katalog
  ADD COLUMN IF NOT EXISTS ar_beraknad boolean NOT NULL DEFAULT false;
ALTER TABLE metadata_katalog
  ADD COLUMN IF NOT EXISTS formel text;
