-- pg_trgm extension for fast case-insensitive substring search ("ILIKE %x%")
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes on object search fields (LOWER for case-insensitive),
-- mirroring the LOWER(...) LIKE '%...%' query in getObjectsPaginated.
CREATE INDEX IF NOT EXISTS idx_objects_name_trgm
  ON objects USING gin (LOWER(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_objects_object_number_trgm
  ON objects USING gin (LOWER(object_number) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_objects_address_trgm
  ON objects USING gin (LOWER(address) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_objects_city_trgm
  ON objects USING gin (LOWER(city) gin_trgm_ops);
