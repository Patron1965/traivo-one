-- Task #1041 — Team-profil: radie & gatusida.
-- Team-/utförarprofilens grupperings- & ruttoptimerings-premisser. Idempotent
-- ADD COLUMN IF NOT EXISTS, additivt (nullable) — påverkar inga befintliga flöden.
-- NULL faller tillbaka på tenant-default (planning_parameters) → motorns default.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS grouping_radius_meters integer,
  ADD COLUMN IF NOT EXISTS street_side_grouping boolean,
  ADD COLUMN IF NOT EXISTS work_pace_percent integer;
