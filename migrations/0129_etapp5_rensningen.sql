-- Task #1217 (Etapp 5): Rensningen — gamla objekt-specialmodellen bort.
-- Ersättarna finns (metadata-områden + uppgiftspaketet, Etapp 1–4); systemet
-- är ej driftsatt så ingen bakåtkompatibilitet behövs. Idempotent och säker
-- att replaya (DROP ... IF EXISTS överallt; db:push kan redan ha droppat).
--
-- KVAR med flit (expand-contract): work_orders.cluster_id, assignments.cluster_id,
-- teams.cluster_id, subscriptions.cluster_id — kolumnerna behålls som inert
-- plumbing men deras FK mot clusters måste bort innan tabellen droppas.

-- 1) FK:er mot clusters strippas på behållna kolumner (namn enligt drizzle-konvention).
ALTER TABLE work_orders  DROP CONSTRAINT IF EXISTS work_orders_cluster_id_clusters_id_fk;
ALTER TABLE assignments  DROP CONSTRAINT IF EXISTS assignments_cluster_id_clusters_id_fk;
ALTER TABLE teams        DROP CONSTRAINT IF EXISTS teams_cluster_id_clusters_id_fk;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_cluster_id_clusters_id_fk;
-- FK:er från kolumner som droppas i steg 4 måste bort FÖRE DROP TABLE clusters.
ALTER TABLE order_concepts DROP CONSTRAINT IF EXISTS order_concepts_target_cluster_id_clusters_id_fk;
ALTER TABLE annual_goals   DROP CONSTRAINT IF EXISTS annual_goals_cluster_id_clusters_id_fk;

-- 2) Specialtabellerna bort.
DROP TABLE IF EXISTS object_payers;
DROP TABLE IF EXISTS object_contacts;
DROP TABLE IF EXISTS object_images;
DROP TABLE IF EXISTS object_vignettes;
DROP TABLE IF EXISTS object_time_restrictions;
DROP TABLE IF EXISTS cluster_capacity_forecast;
DROP TABLE IF EXISTS clusters;

-- 3) Objects specialkolumner bort (åtkomst-gruppen inkl. arvs-/resolved-fält,
--    preferredTime*, container*, servicePeriods, avgSetupTime, utrustningsfält,
--    condition, notes, deliveryPreferences, cluster_id).
ALTER TABLE objects DROP COLUMN IF EXISTS cluster_id;
ALTER TABLE objects DROP COLUMN IF EXISTS access_type;
ALTER TABLE objects DROP COLUMN IF EXISTS access_code;
ALTER TABLE objects DROP COLUMN IF EXISTS access_info;
ALTER TABLE objects DROP COLUMN IF EXISTS key_number;
ALTER TABLE objects DROP COLUMN IF EXISTS access_code_inherited;
ALTER TABLE objects DROP COLUMN IF EXISTS key_number_inherited;
ALTER TABLE objects DROP COLUMN IF EXISTS access_info_inherited;
ALTER TABLE objects DROP COLUMN IF EXISTS resolved_access_code;
ALTER TABLE objects DROP COLUMN IF EXISTS resolved_key_number;
ALTER TABLE objects DROP COLUMN IF EXISTS resolved_access_info;
ALTER TABLE objects DROP COLUMN IF EXISTS preferred_time_1;
ALTER TABLE objects DROP COLUMN IF EXISTS preferred_time_2;
ALTER TABLE objects DROP COLUMN IF EXISTS preferred_time_inherited;
ALTER TABLE objects DROP COLUMN IF EXISTS resolved_preferred_time_1;
ALTER TABLE objects DROP COLUMN IF EXISTS resolved_preferred_time_2;
ALTER TABLE objects DROP COLUMN IF EXISTS container_count;
ALTER TABLE objects DROP COLUMN IF EXISTS container_count_k2;
ALTER TABLE objects DROP COLUMN IF EXISTS container_count_k3;
ALTER TABLE objects DROP COLUMN IF EXISTS container_count_k4;
ALTER TABLE objects DROP COLUMN IF EXISTS service_periods;
ALTER TABLE objects DROP COLUMN IF EXISTS avg_setup_time;
ALTER TABLE objects DROP COLUMN IF EXISTS serial_number;
ALTER TABLE objects DROP COLUMN IF EXISTS manufacturer;
ALTER TABLE objects DROP COLUMN IF EXISTS purchase_date;
ALTER TABLE objects DROP COLUMN IF EXISTS warranty_expiry;
ALTER TABLE objects DROP COLUMN IF EXISTS last_inspection;
ALTER TABLE objects DROP COLUMN IF EXISTS condition;
ALTER TABLE objects DROP COLUMN IF EXISTS notes;
ALTER TABLE objects DROP COLUMN IF EXISTS delivery_preferences;

-- 4) Kluster-pekare på övriga tabeller bort.
ALTER TABLE order_concepts DROP COLUMN IF EXISTS target_cluster_id;
ALTER TABLE order_concepts DROP COLUMN IF EXISTS target_cluster_ids;
ALTER TABLE annual_goals   DROP COLUMN IF EXISTS cluster_id;
