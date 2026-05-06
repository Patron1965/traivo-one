"""
ML Duration Prediction — Training Script (Fas 1)

Tränar LightGBM med Quantile Regression över 4 kvantiler (P10/P50/P75/P90)
på snapshot-data från `ml_feature_snapshots`. Producerar:
  - 4 modellartefakter (.lgb): duration_p10, duration_p50, duration_p75, duration_p90
  - Cross-validation-metrics (MAE, kalibrering per kvantil)
  - SHAP-värden för feature-importance (P50-modellen)
  - 4 nya rader i ml_models-tabellen (status='shadow' tills go-beslut)

Multi-kvantil-stöd låter solver välja prediktion baserat på SLA-criticality:
  - Vanlig planering         → P50  (medianprediktion, balans)
  - Kritiska kunder/SLA      → P75  (lite buffer)
  - Hård deadline / no-miss  → P90  (stor buffer, undviker överskridande)
  - Aggressiv slot-packning  → P10  (optimistisk, för buffert-detektion)

Status: SCAFFOLDING. Aktiveras EFTER att Fas 0 datakvalitetsaudit returnerar
GO (eller WARN+shadow_only — se docs/ml-fas0-fas1-handover.md).

Kör manuellt:
  python scripts/train_duration_model.py --version v0.1.0 --min-rows 500

Acceptanskriterium (från task #421):
  P50-MAE ≤ 15% bättre än heuristisk baseline (estimatedDuration), annars
  promovera INTE från shadow → canary.
  P90-kalibrering: faktisk duration ≤ predicted P90 i ≥85% av fallen.
"""
import argparse
import os
import sys
from datetime import datetime

QUANTILES = [
    ("duration_p10", 0.10),
    ("duration_p50", 0.50),
    ("duration_p75", 0.75),
    ("duration_p90", 0.90),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True, help="Modellversion (t.ex. v0.1.0)")
    parser.add_argument("--min-rows", type=int, default=500, help="Minsta antal träningsrader")
    parser.add_argument("--db-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--artifact-dir", default=".local/ml-artifacts")
    parser.add_argument(
        "--quantiles",
        default="0.10,0.50,0.75,0.90",
        help="Kommaseparerade alpha-värden för quantile regression",
    )
    args = parser.parse_args()

    print(f"[train] Starting LightGBM Quantile Regression training")
    print(f"[train] Version={args.version}  Datum={datetime.utcnow().isoformat()}Z")
    print(f"[train] Quantiles: {args.quantiles}")
    print(f"[train] Modeller som tränas: {[t for t, _ in QUANTILES]}")

    # Stub: ingen riktig träning körs ännu — kräver:
    #   1. lightgbm + shap + pandas + sklearn installerade (optimization-service/requirements.txt)
    #   2. ml_feature_snapshots har ≥{args.min_rows} rader med actualDuration
    #   3. Object Storage-bucket konfigurerad för artefaktuppladdning
    #   4. Explicit go-beslut från PM (Step 4 i task #421) ELLER readinessLevel='shadow_only'
    print("[train] SCAFFOLDING — full implementation gated by Fas 0 audit GO-decision.")
    print("[train] Implementation outline (per kvantil):")
    print("[train]   1. SELECT * FROM ml_feature_snapshots WHERE actual_duration_min IS NOT NULL")
    print("[train]   2. Feature engineering: cyclical encoding (hour, weekday), one-hot execution_code")
    print("[train]   3. Tenant-stratified 5-fold CV, target = actual_duration_min")
    print("[train]   4. För varje alpha i quantiles:")
    print("[train]        params = {'objective': 'quantile', 'alpha': alpha, 'metric': 'quantile',")
    print("[train]                  'learning_rate': 0.05, 'num_leaves': 31, 'min_data_in_leaf': 20}")
    print("[train]        model = lgb.train(params, train_set, num_boost_round=500, early_stopping=50)")
    print("[train]   5. Compute MAE vs heuristic baseline (estimated_duration_min) — gäller P50")
    print("[train]   6. Compute quantile calibration:")
    print("[train]        för P90: faktisk ≤ pred_P90 ska gälla i ≥85% av valideringsraderna")
    print("[train]        för P75: faktisk ≤ pred_P75 ska gälla i ≥70%")
    print("[train]   7. SHAP global feature importance + sample 100 local explanations (P50)")
    print("[train]   8. För varje modell:")
    print("[train]        if calibration OK och (P50: MAE_improvement >= 15%):")
    print("[train]          spara .lgb till Object Storage")
    print("[train]          INSERT ml_models (model_type, version, status='shadow', metrics, ...)")
    print("[train]   9. Status='shadow' (rolloutPct=0). Promotion shadow→canary→active sker via:")
    print("[train]        POST /api/ml/models/:id/promote (platform-owner-only, blue-green lifecycle)")
    print("")
    print("[train] No model produced. Exit code 0 to allow CI smoke-test.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
