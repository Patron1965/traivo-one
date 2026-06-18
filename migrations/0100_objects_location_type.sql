-- Task #990: objektets platsmodell — platstyp (pinpoint/area/none).
-- Idempotent (ADD COLUMN IF NOT EXISTS), nullable, ingen default: legacy-rader förblir
-- NULL och får effektiv platstyp härledd i server/services/object-location.ts.
-- Expand-contract: säkert att re-köra (post-merge replay).
ALTER TABLE "objects" ADD COLUMN IF NOT EXISTS "location_type" text;
