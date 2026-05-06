# ML Duration-Prediktion — Handover (Fas 0 + Fas 1 scaffolding)

**Task:** #421
**Datum:** 2026-05-06
**Status efter denna leverans:** Fas 0 KOMPLETT, Fas 1 SCAFFOLDING (inferens avstängd)

## Vad som levererats i denna session

### Fas 0 — Datainsamling (KOMPLETT, aktiverad)
- **Migration `0035_ml_feature_snapshots.sql`** — två nya tabeller:
  - `ml_feature_snapshots` — frusna features per (WO × resurs × tidpunkt), två snapshot-typer (`pre_optimization`, `post_completion`).
  - `ml_models` — modellregister (status: training | shadow | assist | retired).
- **`server/services/mlFeatureSnapshot.ts`** — write-helper, fail-safe (sväljer alla fel, bryter aldrig planering).
- **`server/optimization-job-runner.ts`** — instrumenterad: efter `callOptimizationService` skrivs en `pre_optimization`-snapshot per WO. Helt non-blocking.
- **`scripts/ml-data-quality-audit.ts`** — go/no-go-grind. Producerar JSON + markdown med:
  - Volymgrind: ≥500 utförda WO totalt
  - Kvalitetsgrind: ≥70% av WO har actualDuration + scheduledDate + executionCode + objektkoppling
  - Per-tenant breakdown
  - Snapshot-statistik
- **`server/routes/mlRoutes.ts`** + admin-vy `client/src/pages/MLDataQualityPage.tsx`:
  - `GET /api/ml/data-quality` (admin-only)
  - `GET /api/ml/snapshots/stats`
  - `GET /api/ml/models`
- Nav-länk under Admin → "ML datakvalitet".

### Fas 1 — Modellträning + shadow-inferens (SCAFFOLDING, AVSTÄNGT)
- **`server/services/mlPredictionClient.ts`** — Node-klient mot `POST /predict/durations`. **Returnerar alltid `null`** om `ML_PREDICTION_ENABLED !== "true"`. Caller faller då tillbaka på heuristisk `estimatedDuration`.
- **`optimization-service/main.py`** — ny endpoint `POST /predict/durations` (stub som returnerar `fallback_used=true`). Kommer att läsa `.lgb`-fil när modellen tränats.
- **`scripts/train_duration_model.py`** — träningsskript-stub. Print-only tills GO-beslut.
- **`optimization-service/requirements.txt`** — `lightgbm` + `shap` adderade.

## Det som INTE kunde göras i denna session (kräver tid + go-beslut)

| Steg | Varför inte nu | När |
|---|---|---|
| Träna riktig LightGBM-modell | Kräver minst 4 veckors snapshot-data + GO från audit | Efter Fas 0 audit returnerar `GO` |
| Aktivera shadow-inferens | Kräver tränad modell + uppladdad till Object Storage | Step 4 i task #421 — explicit go-beslut |
| 2-veckors mätperiod (shadow→assist) | Tar 2 veckor i drift | Efter modell tränats |
| SHAP-loggning per prediktion | Kräver aktiv modell | Aktiveras tillsammans med assist-mode |
| Per-prediktion ai-budget-debitering | Inferens lokal i optimization-service ⇒ låg kostnad — separat budgetpost behövs ej tills extern API används | Vid byte till extern inferens |

## Drift-instruktion för fortsatt arbete

### Vecka 1-4: samla data passivt
Inget att göra. Snapshot-skrivning är aktiv så fort migrationen körts:
```bash
npm run db:push  # eller psql -f migrations/0035_ml_feature_snapshots.sql
```

### Vecka 4: kör go/no-go-audit
```bash
npx tsx scripts/ml-data-quality-audit.ts > /tmp/ml-audit.json
```
Eller via UI: **Admin → ML datakvalitet → Kör audit**.

Kontrollera `goNoGoRecommendation`:
- `GO` → fortsätt med träning
- `WARN` → vänta 2-4 veckor till
- `NO_GO` → undersök varför `actualDuration` inte loggas; instrumentera fältapp/Go

### Vid GO-beslut: träna modell
```bash
# Installera deps i optimization-service
pip install lightgbm shap

# Implementera den faktiska träningen i scripts/train_duration_model.py
# (steg 1-8 i kommentarsblocket)
python scripts/train_duration_model.py --version v0.1.0
```

### Aktivera shadow-mode
1. Ladda upp `.lgb` till Object Storage (privat path).
2. INSERT i `ml_models` med status=`shadow`.
3. Sätt env: `ML_PREDICTION_ENABLED=true` på optimization-service.
4. Kör i 2 veckor — jämför predikterad mot faktisk i `ml_feature_snapshots`.
5. Om MAE-förbättring ≥15% mot heuristik → uppgradera till `assist`-mode.

## Säkerhets- och kontraktsanteckningar
- **Mobile/Go-kontrakt:** OFÖRÄNDRAT. Inga API-endpoint-ändringar mot mobilen. `actualDuration` läses via befintliga write-paths.
- **Tenant-isolation:** Alla snapshot-rader har `tenantId`. Audit-skript är cross-tenant (admin-only — endast för intern observability), per-tenant-routes filtrerar på `req.tenantId`.
- **GDPR:** Snapshot-data innehåller objektkoordinater + postnummer. Inga personuppgifter (namn/telefon) lagras. Vid radering av work_order kaskaderas snapshots (`ON DELETE CASCADE`).
- **Fail-safe:** `writeMlFeatureSnapshot` sväljer alla fel — VRP-jobb och completion-flow kan ALDRIG bryta pga snapshot-skrivning.
- **Inferens-fallback:** Om `predict/durations` timeoutar (>2s) eller returnerar fel ⇒ caller använder heuristisk `estimatedDuration`. Inga jobb kraschar pga ML-fel.

## Acceptanskriterier (per task-spec)
- [x] Fas 0 instrumentering aktiv
- [x] Datakvalitetsgrind 70% implementerad
- [x] Audit-rapport tillgänglig (CLI + admin-UI)
- [x] Fail-safe write-path i executeORToolsJob
- [x] ml_models tabell + scaffolding klar
- [ ] **PAUSE-GRIND:** Vänta på explicit go-beslut innan modellträning startas (Step 4)
- [ ] LightGBM tränad med MAE ≤15% förbättring (efter go)
- [ ] 2-veckors shadow-mätning genomförd (efter go)

## Filer att inspektera
- `migrations/0035_ml_feature_snapshots.sql`
- `server/services/mlFeatureSnapshot.ts`
- `server/services/mlPredictionClient.ts`
- `server/optimization-job-runner.ts` (sök på `writeMlFeatureSnapshot`)
- `server/routes/mlRoutes.ts`
- `client/src/pages/MLDataQualityPage.tsx`
- `scripts/ml-data-quality-audit.ts`
- `scripts/train_duration_model.py`
