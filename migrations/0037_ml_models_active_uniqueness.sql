-- Säkerställ att max EN modell per model_type kan vara 'active' samtidigt.
-- Skydd mot race conditions i blue-green promote-flödet (även om Node-laget
-- nu använder transaktion + FOR UPDATE). DB-laget är sista försvarslinjen.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ml_models_one_active_per_type"
  ON "ml_models" ("model_type")
  WHERE "status" = 'active';

-- Samma sak för canary (max en canary per typ åt gången — annars blir
-- rollout-procentandelar tvetydiga).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ml_models_one_canary_per_type"
  ON "ml_models" ("model_type")
  WHERE "status" = 'canary';
