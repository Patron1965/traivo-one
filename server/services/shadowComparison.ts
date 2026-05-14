/**
 * Shadow comparison plumbing (Task #472, Fas 1).
 *
 * Idé: när primär map-provider (Geoapify) returnerar ett resultat så kör vi
 * fire-and-forget samma anrop mot en alternativ provider (Google) i bakgrunden,
 * jämför resultat och skriver en rad i `map_shadow_comparisons`. Aggregeras
 * sedan av `scripts/shadow-comparison-report.ts`.
 *
 * Garantier:
 *   1. Shadow-anropet får ALDRIG blockera primär-pathen (kör i `setImmediate`).
 *   2. Shadow-fel loggas men kastas inte vidare.
 *   3. Sample-rate styrs av env `MAP_SHADOW_SAMPLE_RATE` (0.0–1.0). Default 0.0.
 *   4. Om ingen shadow-provider är konfigurerad så är hela mekanismen no-op.
 *
 * Tills GoogleMapProvider finns: `getShadowProvider()` returnerar `null` och
 * `withShadow()` blir en pass-through.
 */
import { createHash } from "crypto";
import { db } from "../db";
import { mapShadowComparisons } from "@shared/schema";
import type { MapProvider } from "./mapProvider";
// Statiska imports — ESM hanterar cykeln eftersom funktionerna inte
// utvärderas vid modul-load (de kallas först vid första request).
import { GoogleMapProvider, isGoogleMapProviderAvailable } from "./googleMapProvider";
import { _instantiateGeoapifyForShadow } from "./mapProvider";

const SAMPLE_RATE = (() => {
  const raw = process.env.MAP_SHADOW_SAMPLE_RATE;
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
})();

export type ShadowOperation = "geocode" | "route" | "matrix" | "vrp";

export interface ShadowComputeContext {
  operation: ShadowOperation;
  tenantId?: string;
  /** Stabil request-payload — används för hash + lagras som-är. */
  request: unknown;
  /** Primärsvarets normaliserade form — lagras som-är. */
  primaryResult: unknown;
  primaryDurationMs: number;
  primaryOk: boolean;
}

type ShadowRunner = (provider: MapProvider) => Promise<unknown>;
type DeltaComputer = (primary: unknown, shadow: unknown) => Record<string, unknown> | null;

export interface ShadowOptions {
  ctx: ShadowComputeContext;
  /** Funktion som kör motsvarande anrop mot shadow-providern. */
  shadowRun: ShadowRunner;
  /** Räknar deltan mellan primär och shadow för logging. Får returnera null. */
  computeDeltas?: DeltaComputer;
}

export function isShadowEnabled(): boolean {
  return SAMPLE_RATE > 0 && getShadowProvider() !== null;
}

let _shadowProvider: MapProvider | null | undefined;

/**
 * Returnerar konfigurerad shadow-provider eller null. Lazy-loadad så att
 * Google-providern (när den finns) inte importeras i onödan.
 *
 * Konvention: shadow = "den andra" providern. Om primär är geoapify så är
 * shadow google, och vice versa. Ingen shadow returneras tills Google är
 * implementerad.
 */
export function getShadowProvider(): MapProvider | null {
  if (_shadowProvider !== undefined) return _shadowProvider;
  // Konvention: shadow = "den andra" providern relativt MAP_PROVIDER. Idag är
  // primär Geoapify och shadow Google så fort GOOGLE_MAPS_API_KEY finns.
  const primary = (process.env.MAP_PROVIDER || "geoapify").toLowerCase();
  if (primary === "google") {
    _shadowProvider = _instantiateGeoapifyForShadow();
    return _shadowProvider;
  }

  if (!isGoogleMapProviderAvailable()) {
    _shadowProvider = null;
    return _shadowProvider;
  }

  _shadowProvider = new GoogleMapProvider();
  return _shadowProvider;
}

/** Test-helper: nollställ memoiserad provider efter env-byte. */
export function _resetShadowProviderForTests(): void {
  _shadowProvider = undefined;
}

function shouldSample(): boolean {
  if (SAMPLE_RATE <= 0) return false;
  if (SAMPLE_RATE >= 1) return true;
  return Math.random() < SAMPLE_RATE;
}

function hashRequest(request: unknown): string {
  const json = stableStringify(request);
  return createHash("sha1").update(json).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Trigger shadow-jämförelse i bakgrunden. Anropet returnerar omedelbart;
 * själva shadow-anropet körs i `setImmediate` och loggar resultat fail-safe.
 *
 * Säker att kalla även när shadow är avstängd — den returnerar då direkt utan
 * sidoeffekter.
 */
export function fireShadowComparison(opts: ShadowOptions): void {
  const shadow = getShadowProvider();
  if (!shadow) return;
  if (!shouldSample()) return;

  const { ctx, shadowRun, computeDeltas } = opts;
  setImmediate(() => {
    void runShadow(shadow, ctx, shadowRun, computeDeltas).catch((err) => {
      // Sista försvarslinjen — får aldrig krascha process.
      console.warn(
        "[shadow-comparison] uncaught:",
        err instanceof Error ? err.message : err,
      );
    });
  });
}

async function runShadow(
  shadow: MapProvider,
  ctx: ShadowComputeContext,
  shadowRun: ShadowRunner,
  computeDeltas?: DeltaComputer,
): Promise<void> {
  const start = Date.now();
  let shadowResult: unknown = null;
  let shadowOk = false;
  let shadowError: string | null = null;

  try {
    shadowResult = await shadowRun(shadow);
    shadowOk = shadowResult !== null && shadowResult !== undefined;
  } catch (err) {
    shadowError = err instanceof Error ? err.message : String(err);
  }

  const shadowDurationMs = Date.now() - start;

  let deltas: Record<string, unknown> | null = null;
  if (shadowOk && computeDeltas) {
    try {
      deltas = computeDeltas(ctx.primaryResult, shadowResult);
    } catch (err) {
      console.warn(
        "[shadow-comparison] computeDeltas failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  try {
    // primary = "den andra" relativt shadow. Håller telemetri korrekt även när
    // MAP_PROVIDER=google blir aktivt (då blir shadow=geoapify och primary=google).
    const primaryProvider: "geoapify" | "google" = shadow.name === "google" ? "geoapify" : "google";
    await db.insert(mapShadowComparisons).values({
      tenantId: ctx.tenantId ?? null,
      operation: ctx.operation,
      primaryProvider,
      shadowProvider: shadow.name,
      requestHash: hashRequest(ctx.request),
      request: safeJson(ctx.request),
      primaryResult: safeJson(ctx.primaryResult),
      shadowResult: safeJson(shadowResult),
      deltas: deltas ?? null,
      primaryDurationMs: ctx.primaryDurationMs,
      shadowDurationMs,
      primaryOk: ctx.primaryOk,
      shadowOk,
      shadowError,
    });
  } catch (err) {
    console.warn(
      "[shadow-comparison] DB insert failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

// =============================================================================
// Standardiserade delta-funktioner per operation
// =============================================================================

export function deltasForRouteSummary(
  primary: unknown,
  shadow: unknown,
): Record<string, unknown> | null {
  const p = primary as { distanceKm?: number; durationMinutes?: number } | null;
  const s = shadow as { distanceKm?: number; durationMinutes?: number } | null;
  if (!p || !s) return null;
  const distanceKmDelta = (s.distanceKm ?? 0) - (p.distanceKm ?? 0);
  const durationMinDelta = (s.durationMinutes ?? 0) - (p.durationMinutes ?? 0);
  return {
    distanceKmDelta,
    durationMinDelta,
    distanceKmRelPct: relPct(p.distanceKm, s.distanceKm),
    durationMinRelPct: relPct(p.durationMinutes, s.durationMinutes),
  };
}

export function deltasForGeocode(
  primary: unknown,
  shadow: unknown,
): Record<string, unknown> | null {
  const p = primary as { latitude?: number; longitude?: number } | null;
  const s = shadow as { latitude?: number; longitude?: number } | null;
  if (!p || !s) return null;
  if (p.latitude == null || p.longitude == null || s.latitude == null || s.longitude == null) {
    return null;
  }
  return { distanceMeters: haversineMeters(p.latitude, p.longitude, s.latitude, s.longitude) };
}

function relPct(a: number | undefined, b: number | undefined): number | null {
  if (a == null || b == null) return null;
  if (a === 0) return b === 0 ? 0 : null;
  return ((b - a) / a) * 100;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
