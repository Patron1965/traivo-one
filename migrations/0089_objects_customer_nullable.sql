-- Task #925: Import-wizard kund-agnostisk.
-- ADR v3: objekt är kund-neutrala. `objects.customer_id` är legacy ("under
-- avveckling") — auktoritativ kundkoppling sker via `object_payers` /
-- `work_orders.customer_id`. Gör kolumnen nullable (expand-contract) så den
-- kund-agnostiska 3-stegs import-wizarden kan skapa objekt utan kundbindning.
-- Idempotent: DROP NOT NULL är en no-op om constrainten redan är borttagen.
ALTER TABLE "objects" ALTER COLUMN "customer_id" DROP NOT NULL;
