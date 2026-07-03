-- Task #1153: Restidsmotor — team- & tenant-grundparametrar.
-- Hastighetstak (km/h), restids-/produktions-/vinterfaktor + vinterperiod (mm-dd).
-- Expand-contract: alla kolumner nullable. NULL på team → tenant-default
-- (planning_parameters, raden med customer_id IS NULL AND object_id IS NULL) → motordefault.
-- Idempotent (ADD COLUMN IF NOT EXISTS) så post-merge-replay kan köras om.

ALTER TABLE teams ADD COLUMN IF NOT EXISTS speed_cap_kmh real;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS travel_time_factor real;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS production_time_factor real;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS winter_factor real;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS winter_start text;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS winter_end text;

ALTER TABLE planning_parameters ADD COLUMN IF NOT EXISTS speed_cap_kmh real;
ALTER TABLE planning_parameters ADD COLUMN IF NOT EXISTS travel_time_factor real;
ALTER TABLE planning_parameters ADD COLUMN IF NOT EXISTS production_time_factor real;
ALTER TABLE planning_parameters ADD COLUMN IF NOT EXISTS winter_factor real;
ALTER TABLE planning_parameters ADD COLUMN IF NOT EXISTS winter_start text;
ALTER TABLE planning_parameters ADD COLUMN IF NOT EXISTS winter_end text;
