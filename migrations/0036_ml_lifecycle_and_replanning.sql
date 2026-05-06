-- Task #421 Fas 1+: model lifecycle (blue-green) + counterfactual replanning logging
-- Idempotent: kan köras flera gånger utan biverkningar.

-- 1) ml_models: blue-green deployment-fält
ALTER TABLE "ml_models" ADD COLUMN IF NOT EXISTS "rollout_percentage" integer NOT NULL DEFAULT 0;
ALTER TABLE "ml_models" ADD COLUMN IF NOT EXISTS "previous_model_id" varchar REFERENCES "ml_models"("id") ON DELETE SET NULL;
ALTER TABLE "ml_models" ADD COLUMN IF NOT EXISTS "promoted_at" timestamp;
ALTER TABLE "ml_models" ADD COLUMN IF NOT EXISTS "rollback_reason" text;

-- Constraint: rollout_percentage 0–100
ALTER TABLE "ml_models" DROP CONSTRAINT IF EXISTS "ck_ml_models_rollout_pct";
ALTER TABLE "ml_models" ADD CONSTRAINT "ck_ml_models_rollout_pct"
  CHECK ("rollout_percentage" >= 0 AND "rollout_percentage" <= 100);

-- Status får nu vara: 'training' | 'shadow' | 'canary' | 'active' | 'deprecated' | 'rolled_back'
-- (validerar inte i DB — Node-laget enforcerar enum)

-- 2) replanning_decisions: counterfactual logging för Fas 3 förberedelse
CREATE TABLE IF NOT EXISTS "replanning_decisions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" varchar NOT NULL,
  "decided_at" timestamp NOT NULL DEFAULT NOW(),
  -- Trigger: vad orsakade replanning-prövningen ('eta_slip' | 'no_show' | 'traffic' | 'manual')
  "trigger_kind" text NOT NULL,
  -- Kontext: vilka WO/team berördes (jsonb för flexibilitet)
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Vad regelbaserad policy valde (action + parametrar)
  "rule_based_action" jsonb NOT NULL,
  -- Vad ML SKULLE valt om aktiv (shadow score) — null tills ML-shadow på
  "ml_counterfactual_action" jsonb,
  "ml_counterfactual_score" double precision,
  -- Vad som faktiskt utfördes ('rule_based' | 'ml' | 'manual_override')
  "executed_action_source" text NOT NULL DEFAULT 'rule_based',
  -- Resultat-mätning (fylls i efteråt — eta_diff_minutes, customer_impact, etc.)
  "outcome" jsonb,
  "outcome_measured_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_replanning_tenant_decided" ON "replanning_decisions" ("tenant_id", "decided_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_replanning_trigger" ON "replanning_decisions" ("trigger_kind");
