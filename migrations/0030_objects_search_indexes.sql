-- pg_trgm extension for fast case-insensitive substring search ("ILIKE %x%").
-- Best-effort install (managed Postgres deploys may lack permission); skip
-- the trigram indexes gracefully if the extension is not installed.

DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_trgm';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm extension not available: %', SQLERRM;
  END;
END$$;

-- Trigram GIN indexes on object search fields (LOWER for case-insensitive),
-- mirroring the LOWER(...) LIKE '%...%' query in getObjectsPaginated.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_objects_name_trgm
      ON objects USING gin (LOWER(name) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_objects_object_number_trgm
      ON objects USING gin (LOWER(object_number) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_objects_address_trgm
      ON objects USING gin (LOWER(address) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_objects_city_trgm
      ON objects USING gin (LOWER(city) gin_trgm_ops)';
  ELSE
    RAISE NOTICE 'pg_trgm not installed; skipping object trigram indexes (substring search will be slower)';
  END IF;
END$$;
