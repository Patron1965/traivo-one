-- Task #1110 (Informationspaket på uppgift): stämpla artikelns utförandekod på den
-- expanderade uppgiften (assignment) så den hänger med hela vägen till utförande och
-- är sökbar/sorterbar i grovplaneringen. Expand-contract: nullable, inget default —
-- legacy-rader (NULL) faller tillbaka på derive-at-read via assignment_articles.
-- Idempotent (ADD COLUMN IF NOT EXISTS) så omkörning är säker.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS execution_code text;

-- Filterindex för grovplaneringens utförandekod-filtrering per tenant.
CREATE INDEX IF NOT EXISTS idx_assignments_tenant_execution_code
  ON assignments (tenant_id, execution_code);
