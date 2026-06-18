-- Task #989: Lager- & återtagslogik i uppgiftsmotorn.
-- Generisk "var-är-uppgiften"-intelligens i orderkoncept-expansion:
--   * Varuartikel med lagerplats delas i hämta@lager + leverera@objekt (länkade uppgifter).
--   * Fältmarkering "ej utlämnad / ska återtas" skapar en retur-uppgift till lagerplatsen.
-- Expand-contract: alla kolumner nullable/default ⇒ NULL/false = exakt dagens beteende.
-- Alla satser idempotenta (ADD COLUMN / CREATE INDEX ... IF NOT EXISTS).

-- assignments: hämta/leverera-roll + länk från leverans → hämt-uppgift.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS logistics_role text;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS parent_assignment_id varchar;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'assignments_parent_assignment_id_fkey'
      AND table_name = 'assignments'
  ) THEN
    ALTER TABLE assignments
      ADD CONSTRAINT assignments_parent_assignment_id_fkey
      FOREIGN KEY (parent_assignment_id) REFERENCES assignments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assignments_parent_assignment
  ON assignments (parent_assignment_id);

-- work_orders: logistik-roll + fältmarkering för återtag.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS logistics_role text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS return_to_warehouse boolean DEFAULT false;
