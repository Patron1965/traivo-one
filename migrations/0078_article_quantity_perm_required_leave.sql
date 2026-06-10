-- Artikel: antal-behörighet (Kap 5) + obligatorisk informationslämning (Kap 6).
--
-- Master-spec gap-implementation. Tre nya artikel-flaggor, alla expand-contract
-- (default false → oförändrat beteende för befintliga artiklar):
--   * operator_can_update_quantity = fältarbetaren får ändra antal vid utförande.
--   * free_metadata_update         = nytt antal skrivs tillbaka till objektets metadata.
--   * leave_metadata_required      = leave-metadata (format "value") måste finnas innan
--                                    uppgiften kan slutföras.
-- Alla statements är idempotenta (ADD COLUMN IF NOT EXISTS) så re-körning är säker.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS operator_can_update_quantity boolean DEFAULT false;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS free_metadata_update boolean DEFAULT false;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS leave_metadata_required boolean DEFAULT false;

-- Säkerställ värde på äldre rader (default gäller bara nya rader).
UPDATE articles SET operator_can_update_quantity = false WHERE operator_can_update_quantity IS NULL;
UPDATE articles SET free_metadata_update = false WHERE free_metadata_update IS NULL;
UPDATE articles SET leave_metadata_required = false WHERE leave_metadata_required IS NULL;
