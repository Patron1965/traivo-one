-- Artikel: Antalskälla "Formel" (Mats Antalslogik-omdesign).
--
-- Ny kolumn quantity_formula lagrar ett aritmetiskt uttryck som refererar objektets
-- metadatafält via hakparenteser, t.ex. "[Antal kärl] * 2". Endast aktivt när
-- quantity_mode = 'formula'. Upplöses per objekt i callers (parseFormula ->
-- getArticleMetadataForObject -> evaluateFormula). Expand-contract: nullable, default
-- null -> oförändrat beteende för befintliga artiklar. Idempotent (ADD COLUMN IF NOT
-- EXISTS) så re-körning är säker.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS quantity_formula text;
