-- Task #785 — Veckoplanering: datafundament.
-- Inför veckoplanering som central planeringsentitet per team plus stödtabeller
-- för tidsblock, vila, resor, distrikt, pre-tasks och varningar. Utökar även
-- work_orders med nullable planeringskolumner (expand-contract).
--
-- Idempotent (CREATE TABLE / ADD COLUMN / CREATE INDEX ... IF NOT EXISTS) så att
-- post-merge-replay är säker att köra om. FK-constraints utelämnas här och skapas
-- av drizzle db:push (schema-referensen) för att undvika namnkrock vid replay.

-- === Geografiska distrikt ===
CREATE TABLE IF NOT EXISTS geographic_districts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  name text NOT NULL,
  code text,
  description text,
  color text DEFAULT '#3B82F6',
  center_lat real,
  center_lng real,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_geographic_districts_tenant ON geographic_districts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_geographic_districts_tenant_deleted ON geographic_districts (tenant_id, deleted_at);

-- === Distrikt-zoner ===
CREATE TABLE IF NOT EXISTS district_zones (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  district_id varchar NOT NULL,
  name text NOT NULL,
  code text,
  postal_codes text[] DEFAULT '{}',
  polygon jsonb,
  center_lat real,
  center_lng real,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_district_zones_tenant ON district_zones (tenant_id);
CREATE INDEX IF NOT EXISTS idx_district_zones_district ON district_zones (district_id);

-- === Veckoplaner ===
CREATE TABLE IF NOT EXISTS weekly_plans (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  team_id varchar NOT NULL,
  year integer NOT NULL,
  week_number integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  contracted_hours real,
  total_production_minutes integer DEFAULT 0,
  total_travel_minutes integer DEFAULT 0,
  total_commute_minutes integer DEFAULT 0,
  total_break_minutes integer DEFAULT 0,
  total_personal_minutes integer DEFAULT 0,
  total_rest_minutes integer DEFAULT 0,
  total_overtime_minutes integer DEFAULT 0,
  utilization_rate real,
  total_planned_hours real,
  total_value integer DEFAULT 0,
  total_travel_cost integer DEFAULT 0,
  task_count integer DEFAULT 0,
  rest_type text,
  rest_location text,
  start_location_lat real,
  start_location_lng real,
  end_location_lat real,
  end_location_lng real,
  approved_by varchar,
  approved_at timestamp,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_tenant ON weekly_plans (tenant_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_team ON weekly_plans (team_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_tenant_week ON weekly_plans (tenant_id, year, week_number);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_tenant_deleted ON weekly_plans (tenant_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS unq_weekly_plans_team_week ON weekly_plans (tenant_id, team_id, year, week_number);

-- === Veckoplan-uppgifter (binder work_orders till veckan) ===
CREATE TABLE IF NOT EXISTS weekly_plan_tasks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  weekly_plan_id varchar NOT NULL,
  task_id varchar NOT NULL,
  team_id varchar,
  planned_date date,
  planned_start_time timestamp,
  planned_end_time timestamp,
  sequence integer DEFAULT 0,
  locked boolean NOT NULL DEFAULT false,
  production_minutes integer,
  travel_minutes integer,
  notes text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_tasks_tenant ON weekly_plan_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_tasks_plan ON weekly_plan_tasks (weekly_plan_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_tasks_task ON weekly_plan_tasks (task_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_tasks_plan_date ON weekly_plan_tasks (weekly_plan_id, planned_date);
CREATE UNIQUE INDEX IF NOT EXISTS unq_weekly_plan_tasks_plan_task ON weekly_plan_tasks (weekly_plan_id, task_id);

-- === Personliga uppgifter (icke-produktionsblock) ===
CREATE TABLE IF NOT EXISTS personal_tasks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  weekly_plan_id varchar,
  team_id varchar,
  time_category text NOT NULL,
  title text NOT NULL,
  description text,
  planned_date date,
  start_at timestamp,
  end_at timestamp,
  duration_minutes integer,
  location_lat real,
  location_lng real,
  location_name text,
  from_lat real,
  from_lng real,
  to_lat real,
  to_lng real,
  is_commute boolean NOT NULL DEFAULT false,
  is_generated boolean NOT NULL DEFAULT false,
  source_rule text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_tenant ON personal_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_plan ON personal_tasks (weekly_plan_id);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_team ON personal_tasks (team_id);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_plan_date ON personal_tasks (weekly_plan_id, planned_date);

-- === Scheman som genererar personliga uppgifter ===
CREATE TABLE IF NOT EXISTS personal_task_schedules (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  team_id varchar,
  time_category text NOT NULL,
  title text NOT NULL,
  description text,
  day_of_week integer,
  start_time text,
  duration_minutes integer,
  is_commute boolean NOT NULL DEFAULT false,
  location_lat real,
  location_lng real,
  location_name text,
  active boolean NOT NULL DEFAULT true,
  source_rule text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_personal_task_schedules_tenant ON personal_task_schedules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_personal_task_schedules_team ON personal_task_schedules (team_id);

-- === Restidsposter ===
CREATE TABLE IF NOT EXISTS travel_time_entries (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  weekly_plan_id varchar,
  from_task_id varchar,
  to_task_id varchar,
  from_lat real,
  from_lng real,
  to_lat real,
  to_lng real,
  travel_minutes integer,
  distance_km real,
  travel_cost integer,
  mode text DEFAULT 'driving',
  is_commute boolean NOT NULL DEFAULT false,
  source text,
  planned_date date,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_travel_time_entries_tenant ON travel_time_entries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_travel_time_entries_plan ON travel_time_entries (weekly_plan_id);

-- === Veckoplan-varningar ===
CREATE TABLE IF NOT EXISTS weekly_plan_warnings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  weekly_plan_id varchar NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  code text,
  category text,
  message text NOT NULL,
  related_task_id varchar,
  related_personal_task_id varchar,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamp,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_warnings_tenant ON weekly_plan_warnings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_warnings_plan ON weekly_plan_warnings (weekly_plan_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_warnings_severity ON weekly_plan_warnings (weekly_plan_id, severity);

-- === Pre-tasks (föruppgifter) ===
CREATE TABLE IF NOT EXISTS pre_tasks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  work_order_id varchar,
  title text NOT NULL,
  description text,
  pre_task_type text,
  status text NOT NULL DEFAULT 'pending',
  due_offset_days integer,
  due_at timestamp,
  completed_at timestamp,
  completed_by varchar,
  is_generated boolean NOT NULL DEFAULT false,
  source_rule text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp
);
CREATE INDEX IF NOT EXISTS idx_pre_tasks_tenant ON pre_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pre_tasks_work_order ON pre_tasks (work_order_id);
CREATE INDEX IF NOT EXISTS idx_pre_tasks_tenant_status ON pre_tasks (tenant_id, status);

-- === Regler: utförandetyp → pre-task ===
CREATE TABLE IF NOT EXISTS exec_type_pre_task_rules (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar NOT NULL,
  execution_type text NOT NULL,
  pre_task_type text,
  title text NOT NULL,
  description text,
  offset_days integer DEFAULT 0,
  auto_generate boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exec_type_pre_task_rules_tenant ON exec_type_pre_task_rules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_exec_type_pre_task_rules_exec_type ON exec_type_pre_task_rules (tenant_id, execution_type);

-- === work_orders: nullable planeringskolumner (expand-contract) ===
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS production_time_minutes integer;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS district_id varchar;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS execution_type text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS desired_start_at timestamp;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS desired_end_at timestamp;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS delivery_window_start timestamp;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS delivery_window_end timestamp;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS rough_planned_week text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS preferred_week text;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS centroid_lat real;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS centroid_lng real;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS estimated_travel_min integer;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS parallel_window_json jsonb;
CREATE INDEX IF NOT EXISTS idx_work_orders_district ON work_orders (district_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_rough_week ON work_orders (tenant_id, rough_planned_week);
