-- Task #1153: Tidskod + auto-flagga + framkalkylering på resemoment (travel_time_entries).
-- time_category = time_code_definitions.key (t.ex. travel_commute/setup), auto-klassad men
-- override:bar (time_category_manual). is_auto skiljer motor-genererade job→job-poster från
-- manuella ad-hoc-poster. correction = display-only framkalkylering (rå tid, tak, faktorer).
-- Idempotent så post-merge-replay kan köras om.

ALTER TABLE travel_time_entries ADD COLUMN IF NOT EXISTS time_category text;
ALTER TABLE travel_time_entries ADD COLUMN IF NOT EXISTS time_category_manual boolean NOT NULL DEFAULT false;
ALTER TABLE travel_time_entries ADD COLUMN IF NOT EXISTS is_auto boolean NOT NULL DEFAULT false;
ALTER TABLE travel_time_entries ADD COLUMN IF NOT EXISTS correction jsonb;
