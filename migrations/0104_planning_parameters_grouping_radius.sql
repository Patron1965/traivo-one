-- Task #1038 — Tids- & geografimotorn: konfigurerbar grupperingsradie.
-- Idempotent ADD COLUMN IF NOT EXISTS. Additivt — nullable, påverkar inga
-- befintliga flöden. Motorn faller tillbaka på en applikations-default när NULL.

ALTER TABLE planning_parameters
  ADD COLUMN IF NOT EXISTS grouping_radius_meters integer;
