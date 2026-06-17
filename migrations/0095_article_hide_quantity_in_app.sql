-- Artikel: dölj antalsfält i fältappen (GAP-106 / Task #939).
--
-- Ny artikel-flagga, expand-contract (default false → oförändrat beteende för
-- befintliga artiklar):
--   * hide_quantity_in_app = för artiklar med fast/härlett antal (t.ex. besiktnings-/
--     kontrollartiklar) visas inget redigerbart antalsfält i Traivo Go. Det fasta/
--     härledda antalet används automatiskt vid rapportering/klarmarkering.
-- Statement är idempotent (ADD COLUMN IF NOT EXISTS) så re-körning är säker.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS hide_quantity_in_app boolean DEFAULT false;

-- Säkerställ värde på äldre rader (default gäller bara nya rader).
UPDATE articles SET hide_quantity_in_app = false WHERE hide_quantity_in_app IS NULL;
