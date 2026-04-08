-- Tenant indexes for tables missing them
CREATE INDEX IF NOT EXISTS idx_clusters_tenant ON clusters (tenant_id);
CREATE INDEX IF NOT EXISTS idx_clusters_tenant_status ON clusters (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant ON subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status ON subscriptions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_object_metadata_tenant ON object_metadata (tenant_id);
CREATE INDEX IF NOT EXISTS idx_object_metadata_tenant_object ON object_metadata (tenant_id, object_id);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_object_metadata_object_definition ON object_metadata (object_id, definition_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_resource_date ON work_orders (tenant_id, resource_id, scheduled_date);

-- Functional indexes for case-insensitive LOWER() searches (composite with tenant_id)
CREATE INDEX IF NOT EXISTS idx_customers_tenant_lower_name ON customers (tenant_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_objects_tenant_lower_name ON objects (tenant_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_objects_tenant_lower_address ON objects (tenant_id, LOWER(address));
CREATE INDEX IF NOT EXISTS idx_resources_tenant_lower_name ON resources (tenant_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_articles_tenant_lower_name ON articles (tenant_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_lower_title ON work_orders (tenant_id, LOWER(title));
