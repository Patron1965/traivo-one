-- Task #1124 (Grundbeslut #1): Fakturan utgår från den utförda uppgiften.
-- En utförd avrops-assignment materialiseras till EXAKT EN fakturerbar work_order,
-- länkad via source_assignment_id + order_concept_id, så referenser/fast pris/villkor
-- kan frysas och den befintliga fakturapipelinen (markWorkOrderReadyForInvoice →
-- konsolidering → Fortnox) återanvänds oförändrad. Allt nullable/default
-- (expand-contract): befintliga work_orders/assignments är oförändrade.

-- work_orders: länk tillbaka till assignment/koncept + frusen fast-pris-natur.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS source_assignment_id varchar REFERENCES assignments(id);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS order_concept_id varchar REFERENCES order_concepts(id);
-- Ursprung för fakturaunderlaget: 'assignment' = materialiserad ur utförd uppgift.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invoice_source_type text;
-- Frusen fast-pris-natur (raden är fast belopp, ej antal×styckpris) för radkollaps.
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_is_fixed_price boolean DEFAULT false;
-- Idempotens: en assignment materialiseras till exakt en work_order per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_source_assignment
  ON work_orders (tenant_id, source_assignment_id)
  WHERE source_assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_order_concept
  ON work_orders (tenant_id, order_concept_id);

-- assignments: informationspaket-fält stämplade vid orderkoncept-expansion.
-- is_fixed_price: fast-pris-natur (snapshot av isFixedPriceConcept vid expansion).
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS is_fixed_price boolean DEFAULT false;
-- billing_method: faktureringstyp (call_off/schedule/subscription) snapshot.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS billing_method text;
-- exception_status: undantagsstatus (ej_fakturerbar/ej_genomforbar/makulerad).
-- NULL = normal, fakturerbar. Styr om uppgiften materialiseras till faktura.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS exception_status text;
