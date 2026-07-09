-- Task #1215 (Etapp 3): Uppgiftspaketet — operativ arbetskopia som motorerna
-- läser. Fylls vid uppgiftsskapande och uppdateras av metadata-propageringen
-- för öppna/framtida uppgifter (frysta uppgifter röres aldrig). Nullable
-- (expand-contract): legacy-rader utan paket beter sig som idag.
-- Idempotent (ADD COLUMN IF NOT EXISTS) och säker att replaya.
-- Se shared/uppgift-contract.ts (Uppgiftspaket) och server/services/uppgiftspaket.ts.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS uppgiftspaket jsonb;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS uppgiftspaket jsonb;
