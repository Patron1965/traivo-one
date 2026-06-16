-- Task #941 (GAP-202): Fånga bil/utrustning + deltagare vid klarmarkering så att
-- kostnadsställe (bilens/utrustningens costCenter) och projektkod (utförarens
-- projectCode) kan härledas automatiskt till Fortnox-exporten.
-- Additivt/expand-contract: alla kolumner nullable. Fullt idempotent.

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "completed_vehicle_id" varchar
  REFERENCES "vehicles"("id") ON DELETE SET NULL;
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "completed_equipment_id" varchar
  REFERENCES "equipment"("id") ON DELETE SET NULL;
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "completed_vehicle_reg_no" text;
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "completed_participant_ids" text[];
