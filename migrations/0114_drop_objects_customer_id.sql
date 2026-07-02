-- Task: Objektöversikt – omstrukturering (Item 2)
-- ADR v3: objekt är kund-neutrala. Kundkopplingen bärs numera helt av
-- object_payers (primär betalare); den legacy-kolumn objects.customer_id är
-- oanvänd av all läs-/skrivlogik och droppas här (kontraktsfas — ingen
-- prod-data, ingen expand-contract kvar). API-kontraktet object.customerId
-- bevaras via payer-överlägg (primaryPayerCustomerIdSql / object_payers).
--
-- Alla satser är idempotenta (IF EXISTS) så re-körning i post-merge-replayn
-- är säker.

DROP INDEX IF EXISTS idx_objects_customer;
DROP INDEX IF EXISTS idx_objects_tenant_customer;

ALTER TABLE objects DROP CONSTRAINT IF EXISTS objects_customer_id_customers_id_fk;

ALTER TABLE objects DROP COLUMN IF EXISTS customer_id;
