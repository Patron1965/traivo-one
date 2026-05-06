/**
 * ML Prediction Client (Fas 1 — scaffolding)
 *
 * Node-klient mot optimization-service `POST /predict/durations`.
 *
 * Status: SCAFFOLDING. Inferens aktiveras INTE förrän:
 *   1. Fas 0 har samlat ≥4 veckors snapshot-data per tenant
 *   2. Datakvalitetsgrind (≥70% kompletthet) passerad
 *   3. LightGBM-modell tränad och uppladdad till Object Storage
 *   4. Explicit go-beslut från användare/PM (Step 4 i task-spec)
 *
 * Innan dess: callers får alltid `null` tillbaka och faller tillbaka på
 * heuristisk `estimatedDuration`. Detta är medvetet — task #421 Step 4 kräver
 * pause-grind mellan Fas 0 och Fas 1.
 */
const ML_PREDICT_URL = process.env.OR_TOOLS_SERVICE_URL
  ? `${process.env.OR_TOOLS_SERVICE_URL.replace(/\/$/, "")}/predict/durations`
  : "http://localhost:8090/predict/durations";

const ML_PREDICTION_ENABLED = process.env.ML_PREDICTION_ENABLED === "true";

export interface PredictionRequestRow {
  workOrderId: string;
  estimatedDurationMin: number;
  executionCode?: string | null;
  taskCategory?: string | null;
  weekday?: number | null;
  hourOfDay?: number | null;
  isWeekend?: boolean | null;
  objectLat?: number | null;
  objectLng?: number | null;
}

export interface PredictionResultRow {
  workOrderId: string;
  predictedDurationMin: number;
  p50: number;
  modelVersion: string;
  fallbackUsed: boolean;
}

/**
 * Hämta predikterade durationer i batch.
 * Returnerar `null` om inferens inte är aktiverad eller om servicen inte svarar
 * inom timeout — caller MÅSTE då falla tillbaka på heuristisk skattning.
 */
export async function predictDurations(
  rows: PredictionRequestRow[],
  options: { timeoutMs?: number; tenantId: string } = { tenantId: "" }
): Promise<PredictionResultRow[] | null> {
  if (!ML_PREDICTION_ENABLED) return null;
  if (rows.length === 0) return [];

  const timeoutMs = options.timeoutMs ?? 2000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ML_PREDICT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: options.tenantId, rows }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[ml-predict] non-200 from optimization-service: ${response.status}`);
      return null;
    }
    const data = await response.json() as { predictions?: PredictionResultRow[] };
    return data.predictions ?? null;
  } catch (err) {
    console.warn(
      "[ml-predict] inference call failed (falling back to heuristic):",
      err instanceof Error ? err.message : err
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isMlPredictionEnabled(): boolean {
  return ML_PREDICTION_ENABLED;
}
