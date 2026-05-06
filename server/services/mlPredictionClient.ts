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
  /** Median predicted duration i sekunder. */
  p50Sec: number;
  /** P90 predicted duration i sekunder. */
  p90Sec: number;
  modelVersion: string;
  fallbackUsed: boolean;
}

interface PredictOptions {
  tenantId: string;
  jobs: PredictionRequestRow[];
  timeoutMs?: number;
}

/**
 * Hämta predikterade durationer i batch.
 * Returnerar `null` om inferens inte är aktiverad eller om servicen inte svarar
 * inom timeout — caller MÅSTE då falla tillbaka på heuristisk skattning.
 */
export async function predictDurations(
  opts: PredictOptions
): Promise<PredictionResultRow[] | null> {
  if (!ML_PREDICTION_ENABLED) return null;
  if (!opts.jobs || opts.jobs.length === 0) return [];

  const timeoutMs = opts.timeoutMs ?? 2000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ML_PREDICT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: opts.tenantId, rows: opts.jobs }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[ml-predict] non-200 from optimization-service: ${response.status}`);
      return null;
    }
    const data = await response.json() as {
      predictions?: Array<{
        workOrderId: string;
        predictedDurationMin?: number;
        p50?: number;
        p90?: number;
        modelVersion?: string;
        fallbackUsed?: boolean;
      }>;
    };
    if (!data.predictions) return null;
    // Konvertera Python-svaret (minuter) till Node-konventionen (sekunder).
    return data.predictions.map(p => {
      const p50Min = p.p50 ?? p.predictedDurationMin ?? 0;
      const p90Min = p.p90 ?? p50Min * 1.3;
      return {
        workOrderId: p.workOrderId,
        p50Sec: Math.round(p50Min * 60),
        p90Sec: Math.round(p90Min * 60),
        modelVersion: p.modelVersion ?? "unknown",
        fallbackUsed: p.fallbackUsed === true,
      };
    });
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
