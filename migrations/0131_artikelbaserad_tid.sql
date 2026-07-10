-- Task #1235: artikelbaserad restid/intern tid.
-- Idempotent (ADD COLUMN IF NOT EXISTS) — säker att köra flera gånger.

-- articles: urvalsvillkor för restid-matchning (fordonstyp/vägtyp) + timeCodeKey
-- fanns redan; nya kolumner nedan.
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS travel_vehicle_types TEXT[] DEFAULT '{}';
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS travel_road_types TEXT[] DEFAULT '{}';
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS travel_min_speed_kmh REAL;
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS travel_max_speed_kmh REAL;
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS travel_minutes_per_km REAL;

-- personal_tasks: artikelkoppling + cachead kostnad för icke-produktionstid
-- (vila/lunch/semester/sjukdom/utbildning/administration/egen tid).
ALTER TABLE personal_tasks
  ADD COLUMN IF NOT EXISTS article_id VARCHAR REFERENCES articles(id) ON DELETE SET NULL;
ALTER TABLE personal_tasks
  ADD COLUMN IF NOT EXISTS cached_cost_ore INTEGER;
CREATE INDEX IF NOT EXISTS idx_personal_tasks_article ON personal_tasks(article_id);

-- travel_time_entries: artikelkoppling för resemoment (restid-motorn).
ALTER TABLE travel_time_entries
  ADD COLUMN IF NOT EXISTS article_id VARCHAR REFERENCES articles(id) ON DELETE SET NULL;
