"""
ML Duration Prediction — Training Script (Fas 1 — scaffolding)

Tränar en LightGBM-modell (P50 quantile regression) på snapshot-data från
`ml_feature_snapshots`-tabellen. Producerar:
  - Modellartefakt (.lgb)
  - Cross-validation-metrics (MAE i procent, kalibrering)
  - SHAP-värden för feature-importance
  - Ny rad i ml_models-tabellen (status='shadow' tills go-beslut)

Status: SCAFFOLDING. Aktiveras EFTER att Fas 0 datakvalitetsaudit returnerar GO.

Kör manuellt:
  python scripts/train_duration_model.py --version v0.1.0 --min-rows 500

Acceptanskriterium (från task #421):
  MAE ≤ 15% bättre än heuristisk baseline (estimatedDuration), annars
  uppgradera INTE från shadow → assist.
"""
import argparse
import os
import sys
from datetime import datetime


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True, help="Modellversion (t.ex. v0.1.0)")
    parser.add_argument("--min-rows", type=int, default=500, help="Minsta antal träningsrader")
    parser.add_argument("--db-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--artifact-dir", default=".local/ml-artifacts")
    args = parser.parse_args()

    print(f"[train] Starting LightGBM training for model_type=duration_p50 version={args.version}")
    print(f"[train] Datum: {datetime.utcnow().isoformat()}Z")

    # Stub: ingen riktig träning körs ännu — kräver:
    #   1. lightgbm + shap installerade (se optimization-service/requirements.txt)
    #   2. ml_feature_snapshots har ≥{args.min_rows} rader med actualDuration
    #   3. Object Storage-bucket konfigurerad för artefaktuppladdning
    #   4. Explicit go-beslut från PM (Step 4 i task #421)
    print("[train] SCAFFOLDING — full implementation gated by Fas 0 audit GO-decision.")
    print("[train] Implementation outline:")
    print("[train]   1. SELECT * FROM ml_feature_snapshots WHERE actual_duration_min IS NOT NULL")
    print("[train]   2. Feature engineering: cyclical encoding (hour, weekday), one-hot execution_code")
    print("[train]   3. Tenant-stratified 5-fold CV, target = actual_duration_min")
    print("[train]   4. LightGBM quantile objective alpha=0.5 (P50)")
    print("[train]   5. Compute MAE vs heuristic baseline (estimated_duration_min)")
    print("[train]   6. SHAP global feature importance + sample 100 local explanations")
    print("[train]   7. If MAE_improvement >= 15%: save .lgb to Object Storage, INSERT ml_models")
    print("[train]   8. Status='shadow' (default OFF), upgrade to 'assist' efter 2 veckors mätning")
    print("")
    print("[train] No model produced. Exit code 0 to allow CI smoke-test.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
