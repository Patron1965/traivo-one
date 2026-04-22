-- pg_trgm extension for fast case-insensitive substring search ("ILIKE %x%")
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes on customer search fields (LOWER for case-insensitive)
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (LOWER(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_customer_number_trgm
  ON customers USING gin (LOWER(customer_number) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_email_trgm
  ON customers USING gin (LOWER(email) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_city_trgm
  ON customers USING gin (LOWER(city) gin_trgm_ops);

-- Composite (tenant_id, customer_id) indexes for customer aggregate joins.
-- objects already has idx_objects_tenant_customer; add the missing ones.
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_customer
  ON work_orders (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_clusters_tenant_root_customer
  ON clusters (tenant_id, root_customer_id);
