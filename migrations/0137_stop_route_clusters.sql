-- ADR Klumpning v1: Dynamiska stopp- och ruttklumpar.
-- Idempotent (post-merge-replayable): IF NOT EXISTS överallt.
--
-- Skapar fyra nya tabeller:
--   stop_clusters             – stoppklumpar (operativ, 1-2 veckors horisont)
--   route_clusters            – ruttklumpar (strategisk, upp till 1 år)
--   stop_cluster_memberships  – historik för uppgiftsmedlemskap i stoppklumpar
--   route_cluster_memberships – historik för uppgiftsmedlemskap i ruttklumpar
--
-- Lägger nullable klump-FK-fält på work_orders OCH assignments (Alt B, ADR §3):
--   stop_cluster_id / route_cluster_id   – aktiv klumptillhörighet
--   stop_cluster_calculated_at / route_cluster_calculated_at – beräkningstidsstämpel
--   cluster_lock_status                  – auto | confirmed | locked
--   cluster_exclusion_reason             – fritext om uppgiften exkluderats

-- ============================================================================
-- 1. stop_clusters
-- ============================================================================
CREATE TABLE IF NOT EXISTS stop_clusters (
  id                              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       varchar NOT NULL REFERENCES tenants(id),
  reference_number                text,
  display_name                    text NOT NULL,
  normalized_address              text,
  city                            text,
  latitude                        real,
  longitude                       real,
  radius_meters                   real DEFAULT 30,
  execution_code                  text,
  -- FK till execution_code_definitions (UUID-baserad referensintegritet).
  -- Lagrar även execution_code som text (soft-ref, codebase-konvention) för query-bekvämlighet.
  execution_code_definition_id    varchar REFERENCES execution_code_definitions(id) ON DELETE SET NULL,
  earliest_delivery_at            timestamp,
  latest_delivery_at          timestamp,
  calculated_duration_minutes integer,
  status                      text NOT NULL DEFAULT 'active',
  clustering_rule_version     text,
  last_calculated_at          timestamp,
  created_at                  timestamp NOT NULL DEFAULT now(),
  updated_at                  timestamp NOT NULL DEFAULT now(),
  dissolved_at                timestamp
);

CREATE INDEX IF NOT EXISTS idx_stop_clusters_tenant
  ON stop_clusters(tenant_id);

CREATE INDEX IF NOT EXISTS idx_stop_clusters_tenant_status
  ON stop_clusters(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_stop_clusters_tenant_execution_code
  ON stop_clusters(tenant_id, execution_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stop_clusters_reference_number
  ON stop_clusters(tenant_id, reference_number)
  WHERE reference_number IS NOT NULL;

-- ============================================================================
-- 2. route_clusters
-- ============================================================================
CREATE TABLE IF NOT EXISTS route_clusters (
  id                              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       varchar NOT NULL REFERENCES tenants(id),
  reference_number                text,
  display_name                    text NOT NULL,
  route_description               text,
  center_latitude                 real,
  center_longitude                real,
  radius_kilometers               real DEFAULT 40,
  execution_code                  text,
  -- FK till execution_code_definitions (UUID-baserad referensintegritet).
  execution_code_definition_id    varchar REFERENCES execution_code_definitions(id) ON DELETE SET NULL,
  earliest_delivery_at        timestamp,
  latest_delivery_at          timestamp,
  calculated_work_minutes     integer,
  calculated_travel_minutes   integer,
  precision_level             text DEFAULT 'high',
  status                      text NOT NULL DEFAULT 'active',
  clustering_rule_version     text,
  last_calculated_at          timestamp,
  created_at                  timestamp NOT NULL DEFAULT now(),
  updated_at                  timestamp NOT NULL DEFAULT now(),
  dissolved_at                timestamp
);

CREATE INDEX IF NOT EXISTS idx_route_clusters_tenant
  ON route_clusters(tenant_id);

CREATE INDEX IF NOT EXISTS idx_route_clusters_tenant_status
  ON route_clusters(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_route_clusters_tenant_execution_code
  ON route_clusters(tenant_id, execution_code);

CREATE UNIQUE INDEX IF NOT EXISTS uq_route_clusters_reference_number
  ON route_clusters(tenant_id, reference_number)
  WHERE reference_number IS NOT NULL;

-- ============================================================================
-- 3. stop_cluster_memberships (append-only historik)
-- ============================================================================
CREATE TABLE IF NOT EXISTS stop_cluster_memberships (
  id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        varchar NOT NULL REFERENCES tenants(id),
  stop_cluster_id  varchar NOT NULL REFERENCES stop_clusters(id),
  task_id          varchar NOT NULL,
  task_table       text NOT NULL,   -- 'work_orders' | 'assignments'
  assigned_at      timestamp NOT NULL DEFAULT now(),
  removed_at       timestamp,
  removal_reason   text              -- recluster | manual | dissolved | status_change
);

CREATE INDEX IF NOT EXISTS idx_stop_cluster_memberships_cluster
  ON stop_cluster_memberships(stop_cluster_id);

CREATE INDEX IF NOT EXISTS idx_stop_cluster_memberships_task
  ON stop_cluster_memberships(task_id, task_table);

CREATE INDEX IF NOT EXISTS idx_stop_cluster_memberships_tenant_active
  ON stop_cluster_memberships(tenant_id, removed_at);

-- ============================================================================
-- 4. route_cluster_memberships (append-only historik)
-- ============================================================================
CREATE TABLE IF NOT EXISTS route_cluster_memberships (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         varchar NOT NULL REFERENCES tenants(id),
  route_cluster_id  varchar NOT NULL REFERENCES route_clusters(id),
  task_id           varchar NOT NULL,
  task_table        text NOT NULL,   -- 'work_orders' | 'assignments'
  assigned_at       timestamp NOT NULL DEFAULT now(),
  removed_at        timestamp,
  removal_reason    text
);

CREATE INDEX IF NOT EXISTS idx_route_cluster_memberships_cluster
  ON route_cluster_memberships(route_cluster_id);

CREATE INDEX IF NOT EXISTS idx_route_cluster_memberships_task
  ON route_cluster_memberships(task_id, task_table);

CREATE INDEX IF NOT EXISTS idx_route_cluster_memberships_tenant_active
  ON route_cluster_memberships(tenant_id, removed_at);

-- ============================================================================
-- 5. Nullable klump-fält på work_orders (Alt B, ADR §3)
-- ============================================================================
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS stop_cluster_id              varchar REFERENCES stop_clusters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_cluster_id             varchar REFERENCES route_clusters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stop_cluster_calculated_at   timestamp,
  ADD COLUMN IF NOT EXISTS route_cluster_calculated_at  timestamp,
  ADD COLUMN IF NOT EXISTS cluster_lock_status          text,
  ADD COLUMN IF NOT EXISTS cluster_exclusion_reason     text;

CREATE INDEX IF NOT EXISTS idx_work_orders_stop_cluster
  ON work_orders(stop_cluster_id) WHERE stop_cluster_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_route_cluster
  ON work_orders(route_cluster_id) WHERE route_cluster_id IS NOT NULL;

-- ============================================================================
-- 6. Nullable klump-fält på assignments (Alt B, ADR §3)
-- ============================================================================
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS stop_cluster_id              varchar REFERENCES stop_clusters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_cluster_id             varchar REFERENCES route_clusters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stop_cluster_calculated_at   timestamp,
  ADD COLUMN IF NOT EXISTS route_cluster_calculated_at  timestamp,
  ADD COLUMN IF NOT EXISTS cluster_lock_status          text,
  ADD COLUMN IF NOT EXISTS cluster_exclusion_reason     text;

CREATE INDEX IF NOT EXISTS idx_assignments_stop_cluster
  ON assignments(stop_cluster_id) WHERE stop_cluster_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_route_cluster
  ON assignments(route_cluster_id) WHERE route_cluster_id IS NOT NULL;
