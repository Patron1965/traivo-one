-- Task #925: Import-wizard kund-agnostisk (ADR v3 objekt-neutralitet).
-- Gör import_sessions.customer_id nullable så wizard-sessioner kan skapas
-- utan kundval. Objekt skapas neutrala och kopplas till kund senare via
-- orderkoncept (object_payers / work_orders.customer_id).
-- Expand-contract: kolumnen behålls för bakåtkompatibilitet.
-- Idempotent: DROP NOT NULL på en redan nullable kolumn är en no-op.
ALTER TABLE "import_sessions" ALTER COLUMN "customer_id" DROP NOT NULL;
