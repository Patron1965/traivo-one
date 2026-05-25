import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../logger";
import {
  getMirrorConfig,
  getLastSuccessfulMirrorRun,
} from "../services/github-mirror-scheduler";

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

interface HealthResponse {
  status: "ok" | "degraded";
  checkedAt: string;
  checks: {
    db: CheckResult;
    optimizationService: CheckResult;
    geoapify: CheckResult;
    githubMirror: CheckResult;
  };
}

const CACHE_TTL_MS = 5_000;
let cached: { at: number; response: HealthResponse; httpStatus: number } | null = null;

async function checkDb(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkOptimizationService(): Promise<CheckResult> {
  const url = process.env.OPTIMIZATION_SERVICE_URL || "http://localhost:8090";
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, {
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      latencyMs: Date.now() - start,
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function checkGeoapify(): CheckResult {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key || key.trim() === "") {
    return { ok: false, detail: "GEOAPIFY_API_KEY missing" };
  }
  return { ok: true };
}

// Task #534: degradera healthz om automatiserad GitHub-mirror inte
// har pushat på över N timmar (default 36h, justeras via
// GITHUB_MIRROR_STALENESS_HOURS). Om mirror är medvetet inaktiverad,
// eller om remote/token saknas (manuell rutin gäller), returnerar
// vi ok=true med detail så det syns men inte degraderar healthz.
async function checkGithubMirror(): Promise<CheckResult> {
  const cfg = getMirrorConfig();
  if (!cfg.enabled) {
    return { ok: true, detail: "disabled (GITHUB_MIRROR_ENABLED=false)" };
  }
  if (!cfg.remoteConfigured || !cfg.tokenConfigured) {
    return {
      ok: true,
      detail:
        "ej konfigurerad — manuell rutin (docs/disaster-recovery.md §10) gäller",
    };
  }
  try {
    const last = await getLastSuccessfulMirrorRun();
    if (!last) {
      return {
        ok: false,
        detail: "ingen lyckad push registrerad ännu",
      };
    }
    const ageHours = (Date.now() - new Date(last.ranAt).getTime()) / 3600_000;
    if (ageHours > cfg.stalenessHours) {
      return {
        ok: false,
        detail: `senaste lyckade push för ${ageHours.toFixed(1)}h sedan (>${cfg.stalenessHours}h tröskel)`,
      };
    }
    return {
      ok: true,
      detail: `senaste push för ${ageHours.toFixed(1)}h sedan`,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function buildHealthResponse(): Promise<{ response: HealthResponse; httpStatus: number }> {
  const [dbCheck, optCheck, mirrorCheck] = await Promise.all([
    checkDb(),
    checkOptimizationService(),
    checkGithubMirror(),
  ]);
  const geoCheck = checkGeoapify();

  const allOk = dbCheck.ok && optCheck.ok && geoCheck.ok && mirrorCheck.ok;
  const response: HealthResponse = {
    status: allOk ? "ok" : "degraded",
    checkedAt: new Date().toISOString(),
    checks: {
      db: dbCheck,
      optimizationService: optCheck,
      geoapify: geoCheck,
      githubMirror: mirrorCheck,
    },
  };

  return { response, httpStatus: allOk ? 200 : 503 };
}

export function registerHealthRoutes(app: Express): void {
  app.get("/healthz", async (_req, res) => {
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) {
      res.status(cached.httpStatus).json(cached.response);
      return;
    }
    try {
      const result = await buildHealthResponse();
      cached = { at: now, response: result.response, httpStatus: result.httpStatus };
      if (result.httpStatus !== 200) {
        logger.warn({ checks: result.response.checks }, "healthz degraded");
      }
      res.status(result.httpStatus).json(result.response);
    } catch (err) {
      logger.error({ err }, "healthz check failed unexpectedly");
      res.status(503).json({
        status: "degraded",
        checkedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
