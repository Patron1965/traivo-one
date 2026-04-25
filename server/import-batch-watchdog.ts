import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { importBatches } from "@shared/schema";

const STARTUP_REASON =
  "Avbruten vid serveromstart — körningen avslutades inte korrekt. Kör batchen igen.";
const STALE_REASON_TEMPLATE = (minutes: number) =>
  `Bakgrundsjobbet svarade inte på ${minutes} minuter — markerades som misslyckat. Kör batchen igen.`;

export interface RecoverResult {
  scanned: number;
  recovered: string[];
  /** Batches som hade hunnit progressera/avslutas mellan SELECT och UPDATE — race-säker no-op. */
  raced: string[];
  errors: { batchId: string; error: string }[];
}

/** Form på metadata-fältet vi bryr oss om. Övriga nycklar bevaras orörda. */
interface BatchMetadata {
  status?: "in_progress" | "completed" | "failed";
  lastProgressAt?: string;
  failureReason?: string;
  failedAt?: string;
  failedBy?: string;
  [key: string]: unknown;
}

interface StaleBatchRow {
  id: string;
  batchId: string;
  metadata: BatchMetadata | null;
  createdAt: Date;
}

/**
 * Hitta import_batches där metadata.status = "in_progress" och senaste
 * progress-rapport är äldre än `staleMinutes`. Markerar dessa som "failed"
 * i metadata med en tydlig orsak så UI kan visa felet och låta användaren
 * köra om batchen.
 *
 * Vid serveromstart anropas denna med `staleMinutes = 0` eftersom alla
 * pågående körningar per definition är övergivna efter en omstart (det
 * finns ingen process kvar som kan slutföra dem).
 *
 * Race-säker: UPDATE-satsen guardar både på `status='in_progress'` OCH att
 * `lastProgressAt` är samma värde som vi observerade i SELECT. Om en
 * pågående batch hinner skriva en ny heartbeat eller markeras
 * completed/failed mellan SELECT och UPDATE blir UPDATE en no-op och
 * batchen rapporteras som `raced` (inte `recovered`).
 */
export async function recoverStaleEnrichBatches(
  staleMinutes: number,
  reason?: string,
): Promise<RecoverResult> {
  const cutoffSeconds = Math.max(0, Math.floor(staleMinutes * 60));
  const failureReason =
    reason ??
    (staleMinutes <= 0 ? STARTUP_REASON : STALE_REASON_TEMPLATE(staleMinutes));

  // Vi använder COALESCE(metadata.lastProgressAt, created_at) som "senast aktiv"-
  // tidsstämpel. lastProgressAt skrivs av runEnrichApplyJob varje gång den
  // rapporterar progress; created_at är fallback för rader som aldrig hann
  // få någon progress-uppdatering innan kraschen.
  //
  // Vi castar bara lastProgressAt till timestamptz när strängen ser ut som
  // en ISO-8601-tid. En malformad legacy-metadata får annars hela scanen
  // att kasta — regex-prefiksvalidering filtrerar bort uppenbart skräp,
  // och om casten ändå skulle kasta (t.ex. ISO-format-liknande men
  // omöjligt datum) faller vi automatiskt tillbaka till en degraderad
  // SELECT som ignorerar lastProgressAt helt och bara använder
  // created_at — så watchdogen aldrig blockeras av en enda korrupt rad.
  //
  // Filtrerar på batch_id LIKE 'enrich-modus-%' så watchdogen bara påverkar
  // berikningskörningar (det är de enda som idag använder
  // metadata.status='in_progress'-konventionen). Andra import-typer kan ha
  // egna lifecycle-semantik och ska inte rivas av denna watchdog.
  const enrichStatusFilter = and(
    sql`${importBatches.batchId} LIKE 'enrich-modus-%'`,
    sql`${importBatches.metadata}->>'status' = 'in_progress'`,
  );

  let stale: StaleBatchRow[];
  try {
    stale = await db
      .select({
        id: importBatches.id,
        batchId: importBatches.batchId,
        metadata: sql<BatchMetadata | null>`${importBatches.metadata}`,
        createdAt: importBatches.createdAt,
      })
      .from(importBatches)
      .where(
        and(
          enrichStatusFilter,
          sql`COALESCE(
                CASE
                  WHEN (${importBatches.metadata}->>'lastProgressAt')
                       ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                  THEN (${importBatches.metadata}->>'lastProgressAt')::timestamptz
                  ELSE NULL
                END,
                ${importBatches.createdAt}
              ) < (NOW() - (${cutoffSeconds} || ' seconds')::interval)`,
        ),
      );
  } catch (err) {
    console.warn(
      "[import-watchdog] SELECT med lastProgressAt-cast misslyckades — degraderar till created_at-only-läge:",
      err instanceof Error ? err.message : err,
    );
    stale = await db
      .select({
        id: importBatches.id,
        batchId: importBatches.batchId,
        metadata: sql<BatchMetadata | null>`${importBatches.metadata}`,
        createdAt: importBatches.createdAt,
      })
      .from(importBatches)
      .where(
        and(
          enrichStatusFilter,
          sql`${importBatches.createdAt} < (NOW() - (${cutoffSeconds} || ' seconds')::interval)`,
        ),
      );
  }

  const result: RecoverResult = {
    scanned: stale.length,
    recovered: [],
    raced: [],
    errors: [],
  };

  for (const row of stale) {
    try {
      const existingMeta: BatchMetadata = row.metadata ?? {};
      const lastProgressSnapshot = existingMeta.lastProgressAt;

      // Race-guard: skriv bara om status fortfarande är "in_progress" OCH
      // lastProgressAt är samma värde vi observerade i SELECT. Om jobbet
      // hann skriva en ny heartbeat blir UPDATE en no-op och vi rapporterar
      // batchen som `raced` istället för att klobba färsk progress.
      //
      // OBS: legacy-rader kan ha `lastProgressAt: null` explicit (JSON null,
      // inte saknad nyckel). I JavaScript är detta `null`, inte `undefined`,
      // så vi använder loose equality (`== null`) som matchar båda — annars
      // hade en `= NULL`-jämförelse i SQL aldrig blivit true och raden hade
      // felaktigt rapporterats som raced i evighet.
      const lastProgressGuard = lastProgressSnapshot == null
        ? sql`(${importBatches.metadata}->>'lastProgressAt') IS NULL`
        : sql`(${importBatches.metadata}->>'lastProgressAt') = ${lastProgressSnapshot}`;

      const updated = await db
        .update(importBatches)
        .set({
          metadata: {
            ...existingMeta,
            status: "failed",
            failureReason,
            failedAt: new Date().toISOString(),
            failedBy: "watchdog",
          },
        })
        .where(
          and(
            eq(importBatches.id, row.id),
            sql`${importBatches.metadata}->>'status' = 'in_progress'`,
            lastProgressGuard,
          ),
        )
        .returning({ id: importBatches.id });

      if (updated.length === 0) {
        result.raced.push(row.batchId);
      } else {
        result.recovered.push(row.batchId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ batchId: row.batchId, error: message });
    }
  }

  return result;
}

let watchdogTimer: NodeJS.Timeout | null = null;

export interface WatchdogOptions {
  /** Körs en gång vid start. Default: 0 minuter (alla in_progress markeras failed). */
  startupStaleMinutes?: number;
  /** Tröskel för periodisk kontroll. Default: 10 minuter. */
  periodicStaleMinutes?: number;
  /** Hur ofta watchdog körs efter start. Default: 5 minuter. */
  intervalMinutes?: number;
}

/**
 * Startar watchdog som:
 *   1. Vid uppstart markerar ALLA pågående batches som failed (de är per
 *      definition övergivna eftersom ingen annan process håller på med dem).
 *   2. Återkommande kontrollerar att aktiva batches gör progress; om en batch
 *      inte rapporterat aktivitet på `periodicStaleMinutes` markeras den failed.
 *
 * Returnerar resultatet av startup-körningen så index.ts kan logga det.
 */
export async function startImportBatchWatchdog(
  options: WatchdogOptions = {},
): Promise<RecoverResult> {
  const {
    startupStaleMinutes = 0,
    periodicStaleMinutes = 10,
    intervalMinutes = 5,
  } = options;

  const startupResult = await recoverStaleEnrichBatches(startupStaleMinutes);

  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  const intervalMs = Math.max(1, Math.floor(intervalMinutes * 60_000));
  watchdogTimer = setInterval(() => {
    recoverStaleEnrichBatches(periodicStaleMinutes)
      .then((res) => {
        if (res.recovered.length > 0) {
          console.log(
            `[import-watchdog] markerade ${res.recovered.length} stale batch(es) som failed: ${res.recovered.join(", ")}`,
          );
        }
        if (res.raced.length > 0) {
          console.log(
            `[import-watchdog] ${res.raced.length} batch(es) hann progressera mellan SELECT och UPDATE — lämnades orörda: ${res.raced.join(", ")}`,
          );
        }
        if (res.errors.length > 0) {
          console.error(
            `[import-watchdog] ${res.errors.length} batch(es) kunde inte markeras failed:`,
            res.errors,
          );
        }
      })
      .catch((err) => {
        console.error("[import-watchdog] periodisk körning kraschade:", err);
      });
  }, intervalMs);

  if (typeof watchdogTimer.unref === "function") {
    watchdogTimer.unref();
  }

  return startupResult;
}

/** För tester: stoppa schemaläggaren. */
export function stopImportBatchWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}
