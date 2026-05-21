-- Task #520: Enhetsansvarig — break-even per resurs.
-- Lägg till tenant-default-fält i planning_parameters så att dagsmål och
-- stopp/timme kan konfigureras centralt (customer_id=null, object_id=null).
-- Båda fälten är nullable och saknar default → bakåtkompatibelt med
-- befintliga rader och nuvarande planeringskod.

ALTER TABLE "planning_parameters"
  ADD COLUMN IF NOT EXISTS "daily_stop_target" integer;--> statement-breakpoint
ALTER TABLE "planning_parameters"
  ADD COLUMN IF NOT EXISTS "stops_per_hour" real;
