-- Task #421: ML duration-prediktion (Fas 0 + Fas 1)
-- Lägger grund för data-snapshot per (work_order × resurs × tidpunkt) som matar
-- LightGBM-träning. Idempotent: körs säkert flera gånger.

CREATE TABLE IF NOT EXISTS "ml_feature_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "work_order_id" varchar NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
  "resource_id" varchar REFERENCES "resources"("id") ON DELETE SET NULL,
  "object_id" varchar REFERENCES "objects"("id") ON DELETE SET NULL,
  -- Snapshot-källa: 'pre_optimization' (vid VRP-jobb) eller 'post_completion' (vid utförd order)
  "snapshot_kind" text NOT NULL,
  -- Tidpunkt features togs ut (frusna)
  "snapshot_at" timestamp NOT NULL DEFAULT NOW(),
  -- Numeriska features (samma som blir input till LightGBM)
  "estimated_duration_min" integer,
  "actual_duration_min" integer,
  "setup_minutes" integer,
  "execution_code" text,
  "task_category" text,
  "weekday" integer, -- 0=mån, 6=sön
  "hour_of_day" integer,
  "month" integer,
  "is_weekend" boolean,
  -- Objekt-features
  "object_postal_code" text,
  "object_lat" real,
  "object_lng" real,
  -- Resursvektor (om känd vid snapshot)
  "resource_experience_days" integer,
  -- Råjson för framtida feature-utvidgning utan migration
  "raw_features" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Datakvalitetsflagga (sätts av audit-skript)
  "quality_score" real,
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_ml_snapshots_tenant" ON "ml_feature_snapshots" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_ml_snapshots_kind_created" ON "ml_feature_snapshots" ("snapshot_kind", "created_at");
CREATE INDEX IF NOT EXISTS "idx_ml_snapshots_wo" ON "ml_feature_snapshots" ("work_order_id");
CREATE INDEX IF NOT EXISTS "idx_ml_snapshots_tenant_kind_created" ON "ml_feature_snapshots" ("tenant_id", "snapshot_kind", "created_at");

-- Modellregister: Fas 1 förbereder, ingen modell aktiveras innan go-beslut.
CREATE TABLE IF NOT EXISTS "ml_models" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Modelltyp: 'duration_p50' (Fas 1), framtida: 'duration_p90', 'setup_time'
  "model_type" text NOT NULL,
  -- Versionssträng (semver eller datum-tag), unik per typ
  "version" text NOT NULL,
  -- Status: 'training' | 'shadow' | 'assist' | 'retired'
  "status" text NOT NULL DEFAULT 'training',
  -- Sökväg i Object Storage till .lgb-fil (privat path)
  "artifact_path" text,
  -- Träningsmetadata
  "trained_at" timestamp,
  "training_rows" integer,
  "training_tenants" text[],
  -- Metrics från cross-validation (MAE i procent, R², kalibrering)
  "metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Feature-lista (samma ordning som modellens input)
  "feature_names" text[],
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_ml_models_type_version" UNIQUE ("model_type", "version")
);

CREATE INDEX IF NOT EXISTS "idx_ml_models_type_status" ON "ml_models" ("model_type", "status");
