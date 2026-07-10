-- Å3: tenant_id-täckning på växande kärntabeller (defense-in-depth + skala).
-- Å5: geospatialt index för närhets-/30m-sökning på objects(lat,lng).
-- Alla idempotenta (CREATE INDEX IF NOT EXISTS). Inga schema.ts-ändringar krävs;
-- schema-drift-check flaggar bara index som FINNS i schema.ts men saknas i DB.

CREATE INDEX IF NOT EXISTS idx_metadata_varden_tenant ON metadata_varden (tenant_id);
CREATE INDEX IF NOT EXISTS idx_metadata_historik_tenant ON metadata_historik (tenant_id);
CREATE INDEX IF NOT EXISTS idx_article_components_tenant ON article_components (tenant_id);
CREATE INDEX IF NOT EXISTS idx_price_lists_tenant ON price_lists (tenant_id);
-- object_payers/object_contacts/object_images droppades i 0129 (Etapp 5) — guarda.
DO $$ BEGIN
  IF to_regclass('public.object_payers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_object_payers_tenant ON object_payers (tenant_id);
  END IF;
  IF to_regclass('public.object_contacts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_object_contacts_tenant ON object_contacts (tenant_id);
  END IF;
  IF to_regclass('public.object_images') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_object_images_tenant ON object_images (tenant_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_equipment_tenant ON equipment (tenant_id);
CREATE INDEX IF NOT EXISTS idx_teams_tenant ON teams (tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_tenant ON task_dependencies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_dependency_instances_tenant ON task_dependency_instances (tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_information_tenant ON task_information (tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_metadata_updates_tenant ON task_metadata_updates (tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_desired_timewindows_tenant ON task_desired_timewindows (tenant_id);

-- Heta kompositfilter som testplanen pekade ut (Orderkoncept per kund, WO per status).
CREATE INDEX IF NOT EXISTS idx_order_concepts_tenant_customer ON order_concepts (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_status ON work_orders (tenant_id, status);

-- Å5: geospatialt index för bounding-box/närhetssökning (30m jobbgruppering m.m.).
CREATE INDEX IF NOT EXISTS idx_objects_tenant_lat_lng
  ON objects (tenant_id, latitude, longitude)
  WHERE deleted_at IS NULL;
