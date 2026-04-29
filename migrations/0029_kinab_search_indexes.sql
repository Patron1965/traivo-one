-- pg_trgm extension for fast case-insensitive substring search ("ILIKE %x%").
-- On managed Postgres providers (e.g. Replit production) the deploy user may
-- lack CREATE EXTENSION privilege. We try once, ignore permission errors, and
-- only create the trigram indexes if the extension actually ended up installed.

DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_trgm';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm extension not available: %', SQLERRM;
  END;
END$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
      ON customers USING gin (LOWER(name) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_customer_number_trgm
      ON customers USING gin (LOWER(customer_number) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_email_trgm
      ON customers USING gin (LOWER(email) gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_city_trgm
      ON customers USING gin (LOWER(city) gin_trgm_ops)';
  ELSE
    RAISE NOTICE 'pg_trgm not installed; skipping customer trigram indexes (substring search will be slower)';
  END IF;
END$$;

-- Composite (tenant_id, customer_id) indexes for customer aggregate joins.
-- These do NOT require pg_trgm and are always created.
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_customer
  ON work_orders (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_clusters_tenant_root_customer
  ON clusters (tenant_id, root_customer_id);
