// Task #578: Tre-stegs import-wizard.
// Endpoints för guidat onboarding-flöde:
//   POST   /api/import/wizard/sessions                       skapa session (kund-agnostisk)
//   GET    /api/import/wizard/sessions/:id                   hämta session-state
//   POST   /api/import/wizard/sessions/:id/preview           dry-run validering per steg
//   POST   /api/import/wizard/sessions/:id/commit            commit steg (skapar objects)
//   POST   /api/import/wizard/sessions/:id/abandon           markera abandoned
//
// Interim-IDn (t.ex. "ORG-1", "BUT-101") läggs till i `interim_map` när varje
// steg committas och kan refereras som `parentInterim` i nästkommande steg.
// Adress ärvs automatiskt från överordnat objekt om raden saknar adress.

import type { Express } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler";
import { NotFoundError, ValidationError } from "../errors";
import { getTenantIdWithFallback } from "../tenant-middleware";
import { formatZodError, verifyTenantOwnership } from "./helpers";
import { db } from "../db";
import { importBatches, importSessions, objects } from "@shared/schema";
import { storage } from "../storage";
import {
  getAllMetadataTypes,
  writeObjectImportMetadataBatch,
  type ImportMetadataBatchField,
} from "../metadata-queries";
import { groupMetadataForWrite } from "../services/object-import-core";

type StepNumber = 1 | 2 | 3;

const rowSchemaStep1 = z.object({
  interim: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  hierarchyLevel: z.string().trim().max(64).optional(),
  parentInterim: z.string().trim().max(64).optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const rowSchemaStep2 = z.object({
  interim: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  parentInterim: z.string().trim().min(1).max(64),
  objectNumber: z.string().trim().max(64).optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const rowSchemaStep3 = z.object({
  interim: z.string().trim().max(64).optional(),
  name: z.string().trim().min(1).max(200),
  parentInterim: z.string().trim().min(1).max(64),
  objectNumber: z.string().trim().max(64).optional(),
  hierarchyLevel: z.string().trim().max(64).optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const stepBodySchema = z.object({
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  rows: z.array(z.record(z.string(), z.any())).min(1).max(2000),
});

interface NormalizedRow {
  index: number;
  interim: string | null;
  name: string;
  parentInterim: string | null;
  objectNumber: string | null;
  hierarchyLevel: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  metadata: Record<string, string> | null;
}

interface RowError {
  index: number;
  message: string;
}

interface PreviewItem {
  index: number;
  name: string;
  interim: string | null;
  resolvedParentName?: string | null;
  inheritedAddress?: boolean;
}

function normalizeRow(step: StepNumber, raw: Record<string, any>, index: number): { row?: NormalizedRow; error?: RowError } {
  const schema = step === 1 ? rowSchemaStep1 : step === 2 ? rowSchemaStep2 : rowSchemaStep3;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { error: { index, message: msg || "Ogiltig rad" } };
  }
  const d: any = parsed.data;
  return {
    row: {
      index,
      interim: d.interim?.trim() || null,
      name: d.name.trim(),
      parentInterim: d.parentInterim?.trim() || null,
      objectNumber: d.objectNumber?.trim() || null,
      hierarchyLevel: d.hierarchyLevel?.trim() || null,
      address: d.address?.trim() || null,
      city: d.city?.trim() || null,
      postalCode: d.postalCode?.trim() || null,
      metadata: normalizeMetadata(d.metadata),
    },
  };
}

// Trimma metadata-nycklar/värden och släng tomma. Returnerar null när inget
// användbart återstår (så commit kan hoppa metadata-skrivningen helt).
function normalizeMetadata(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim();
    const val = v == null ? "" : String(v).trim();
    if (key && val) out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}

interface MetadataIntent {
  objectId: string;
  parentObjectId: string | null;
  metadata: Record<string, string>;
}

// Skriver mappad metadata till de nyss skapade objekten. Körs EFTER objekt-
// transaktionen (se commit-handlern). Tenant-validerar varje nyckel mot
// metadata_katalog.namn (klienten är bara UX — vi litar aldrig blint på dess
// nyckelnamn) och skapar ALDRIG nya katalog-rader: okända nycklar hoppas och
// rapporteras som varningar. Composite-nycklar (`grupp.underfält`) grupperas
// av groupMetadataForWrite till JSON-fält. Returnerar en lista varningar.
async function writeWizardMetadata(
  tenantId: string,
  intents: MetadataIntent[],
  skapadAv: string | undefined,
): Promise<string[]> {
  if (intents.length === 0) return [];
  const warnings: string[] = [];

  const katalogTypes = await getAllMetadataTypes(tenantId);
  const katalogByName = new Map(katalogTypes.map((k) => [k.namn, k]));

  const unknownKeys = new Set<string>();
  for (const intent of intents) {
    const { strings, jsonGroups } = groupMetadataForWrite(intent.metadata);
    const fields: ImportMetadataBatchField[] = [];
    for (const s of strings) {
      if (!katalogByName.has(s.namn)) {
        unknownKeys.add(s.namn);
        continue;
      }
      fields.push({ namn: s.namn, varde: s.varde });
    }
    for (const g of jsonGroups) {
      if (!katalogByName.has(g.namn)) {
        unknownKeys.add(g.namn);
        continue;
      }
      fields.push({ namn: g.namn, varde: g.varde });
    }
    if (fields.length === 0) continue;
    try {
      await writeObjectImportMetadataBatch({
        tenantId,
        objektId: intent.objectId,
        objectParentId: intent.parentObjectId,
        isNewObject: true,
        fields,
        katalogByName,
        skapadAv,
      });
    } catch (err: any) {
      warnings.push(
        `Metadata kunde inte skrivas för ett objekt: ${err?.message ?? String(err)}`,
      );
    }
  }

  if (unknownKeys.size > 0) {
    warnings.push(
      `Okända metadatatyper hoppades över (finns inte i katalogen): ${Array.from(unknownKeys).join(", ")}. Skapa dem under Metadata först.`,
    );
  }
  return warnings;
}

interface InterimEntry {
  objectId: string;
  step: number;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
}

type InterimMap = Record<string, InterimEntry>;

async function loadInheritedAddress(
  parentInterim: string | null,
  interimMap: InterimMap,
): Promise<{ address: string | null; city: string | null; postalCode: string | null; parentName: string | null } | null> {
  if (!parentInterim) return null;
  const entry = interimMap[parentInterim];
  if (!entry) return null;
  return {
    address: entry.address,
    city: entry.city,
    postalCode: entry.postalCode,
    parentName: entry.name,
  };
}

async function validateRows(
  step: StepNumber,
  rawRows: Array<Record<string, any>>,
  interimMap: InterimMap,
): Promise<{ rows: NormalizedRow[]; errors: RowError[]; preview: PreviewItem[]; duplicates: number }> {
  // Spec: parent får referera vilket som helst tidigare commit:at steg (eller
  // samma steg för kedjning inom batch). Steg 2 kan ärva från steg 1; steg 3
  // kan ärva från steg 1 eller steg 2 (interimnummer från steg 1 ska gå att
  // referera direkt i steg 3, t.ex. när en organisation äger objekt utan butik).
  const allowedParentSteps: Record<StepNumber, number[]> = {
    1: [1],
    2: [1, 2],
    3: [1, 2, 3],
  };
  const allowedForStep = allowedParentSteps[step];
  const errors: RowError[] = [];
  const rows: NormalizedRow[] = [];
  const seenInterimInBatch = new Map<string, number>();

  for (let i = 0; i < rawRows.length; i++) {
    const r = normalizeRow(step, rawRows[i] ?? {}, i);
    if (r.error) {
      errors.push(r.error);
      continue;
    }
    rows.push(r.row!);
  }

  const preview: PreviewItem[] = [];
  let duplicates = 0;
  const localMap: InterimMap = { ...interimMap };

  for (const row of rows) {
    // Unikhet på interim: får inte krocka med sessionens map eller andra rader
    if (row.interim) {
      if (localMap[row.interim]) {
        errors.push({ index: row.index, message: `Interim-ID "${row.interim}" finns redan i sessionen` });
        duplicates++;
        continue;
      }
      const prevIdx = seenInterimInBatch.get(row.interim);
      if (prevIdx !== undefined) {
        errors.push({ index: row.index, message: `Interim-ID "${row.interim}" finns på rad ${prevIdx + 1} också` });
        duplicates++;
        continue;
      }
      seenInterimInBatch.set(row.interim, row.index);
    }

    // Parent-resolution + steg-tillhörighet
    let parentName: string | null = null;
    let inherited = false;
    if (row.parentInterim) {
      const parent = localMap[row.parentInterim];
      if (!parent) {
        errors.push({
          index: row.index,
          message: `Överordnat interim "${row.parentInterim}" hittades inte (måste finnas i tidigare steg eller före denna rad)`,
        });
        continue;
      }
      if (!allowedForStep.includes(parent.step)) {
        errors.push({
          index: row.index,
          message: `Överordnat "${row.parentInterim}" tillhör steg ${parent.step}; steg ${step} accepterar steg ${allowedForStep.join("/")}.`,
        });
        continue;
      }
      parentName = parent.name;
      if (!row.address && parent.address) {
        inherited = true;
      }
    } else if (step === 2 || step === 3) {
      errors.push({ index: row.index, message: `Steg ${step} kräver 'parentInterim'` });
      continue;
    }

    // Lägg in pseudo-entry i localMap så efterföljande rader i samma batch
    // kan referera den (parent-kedja inom samma steg).
    if (row.interim) {
      localMap[row.interim] = {
        objectId: "<pending>",
        step,
        name: row.name,
        address: row.address ?? localMap[row.parentInterim ?? ""]?.address ?? null,
        city: row.city ?? localMap[row.parentInterim ?? ""]?.city ?? null,
        postalCode: row.postalCode ?? localMap[row.parentInterim ?? ""]?.postalCode ?? null,
      };
    }

    preview.push({
      index: row.index,
      name: row.name,
      interim: row.interim,
      resolvedParentName: parentName,
      inheritedAddress: inherited,
    });
  }

  return { rows, errors, preview, duplicates };
}

export function registerImportWizardRoutes(app: Express): void {
  // === Metadatatyper (för kolumn-mappning) ==================================
  // Listar tenantens metadata_katalog-typer så wizardens mappnings-UI kan
  // erbjuda dem som mål för fria kolumner. Mappning sker mot `namn` (den
  // stabila nyckel som metadata-skrivningen matchar på).
  app.get(
    "/api/import/wizard/metadata-types",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const types = await getAllMetadataTypes(tenantId);
      res.set("Cache-Control", "no-cache, must-revalidate");
      res.json({
        types: types.map((t) => ({
          namn: t.namn,
          beteckning: t.beteckning ?? null,
          beskrivning: t.beskrivning ?? null,
        })),
      });
    }),
  );

  // === Skapa session ========================================================
  app.post(
    "/api/import/wizard/sessions",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);

      // Wizard är kund-agnostisk (ADR v3): objekt skapas neutrala och kopplas
      // till kund senare via orderkoncept (object_payers / work_orders.customer_id).
      // Ingen customerId krävs eller lagras.
      const userId = (req as any).user?.claims?.sub ?? (req as any).user?.id ?? null;
      const [session] = await db
        .insert(importSessions)
        .values({
          tenantId,
          createdBy: userId,
        })
        .returning();
      res.json(session);
    }),
  );

  // === Hämta session ========================================================
  app.get(
    "/api/import/wizard/sessions/:id",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const [session] = await db
        .select()
        .from(importSessions)
        .where(and(eq(importSessions.id, req.params.id), eq(importSessions.tenantId, tenantId)));
      if (!session) throw new NotFoundError("Import-session");
      res.set("Cache-Control", "no-cache, must-revalidate");
      res.json(session);
    }),
  );

  // === Preview (dry-run) ====================================================
  app.post(
    "/api/import/wizard/sessions/:id/preview",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const [session] = await db
        .select()
        .from(importSessions)
        .where(and(eq(importSessions.id, req.params.id), eq(importSessions.tenantId, tenantId)));
      if (!session) throw new NotFoundError("Import-session");

      const parsed = stepBodySchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);
      const step = parsed.data.step as StepNumber;
      if (step !== session.stepCompleted + 1) {
        throw new ValidationError(
          `Steg ${step} kan inte förhandsgranskas — senast committade steg är ${session.stepCompleted}. Nästa steg är ${session.stepCompleted + 1}.`,
        );
      }
      const interimMap = (session.interimMap as InterimMap) ?? {};
      const result = await validateRows(step, parsed.data.rows, interimMap);
      res.json({
        dryRun: true,
        step,
        valid: result.preview.length,
        invalid: result.errors.length,
        duplicates: result.duplicates,
        errors: result.errors,
        preview: result.preview,
      });
    }),
  );

  // === Commit ===============================================================
  app.post(
    "/api/import/wizard/sessions/:id/commit",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const [session] = await db
        .select()
        .from(importSessions)
        .where(and(eq(importSessions.id, req.params.id), eq(importSessions.tenantId, tenantId)));
      if (!session) throw new NotFoundError("Import-session");
      if (session.status !== "in_progress") {
        throw new ValidationError(`Sessionen är ${session.status === "completed" ? "redan slutförd" : "avbruten"}`);
      }

      const parsed = stepBodySchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError(formatZodError(parsed.error).error);
      const step = parsed.data.step as StepNumber;
      if (step !== session.stepCompleted + 1) {
        throw new ValidationError(
          `Förväntade steg ${session.stepCompleted + 1}, fick ${step}. Stegen måste committas i ordning.`,
        );
      }

      const interimMap: InterimMap = { ...((session.interimMap as InterimMap) ?? {}) };
      const validation = await validateRows(step, parsed.data.rows, interimMap);
      if (validation.errors.length > 0) {
        // Inkludera ett läsbart `message` så även den generiska klient-
        // felhanteraren (apiRequest/throwIfResNotOk) visar något åtgärdbart —
        // annars hamnar man på "400:" utan text. Den strukturerade `errors`-
        // arrayen + `preview` driver den detaljerade per-rad-panelen.
        const firstError = validation.errors[0]?.message ?? "";
        const message =
          `${validation.errors.length} rad(er) blockerade${firstError ? `: ${firstError}` : ""}. ` +
          `Förhandsgranska steget för att se alla fel.`;
        return res.status(400).json({
          ok: false,
          step,
          valid: validation.preview.length,
          invalid: validation.errors.length,
          duplicates: validation.duplicates,
          errors: validation.errors,
          preview: validation.preview,
          message,
        });
      }

      // Atomär commit: all-or-nothing per steg. Om någon rad failar rullas
      // hela transaktionen tillbaka — annars riskerar vi blandat tillstånd
      // (delade objekt i interim_map men stepCompleted oförändrat).
      const batchId = `wizard-s${step}-${session.id.slice(0, 8)}-${Date.now()}`;
      const hierarchyDefaultByStep: Record<StepNumber, string> = {
        1: "koncern",
        2: "fastighet",
        3: "karl",
      };

      try {
        const result = await db.transaction(async (tx) => {
          // Optimistisk lås: kontrollera att sessionen fortfarande är på
          // förväntat steg & status. Förhindrar konkurrerande commits från
          // att dubbel-skapa objekt.
          const guarded = await tx
            .update(importSessions)
            .set({ updatedAt: new Date() })
            .where(
              and(
                eq(importSessions.id, session.id),
                eq(importSessions.tenantId, tenantId),
                eq(importSessions.stepCompleted, session.stepCompleted),
                eq(importSessions.status, "in_progress"),
              ),
            )
            .returning({ id: importSessions.id });
          if (guarded.length === 0) {
            throw new ValidationError(
              "Sessionen har ändrats av en samtidig commit. Ladda om och försök igen.",
            );
          }

          const createdIds: string[] = [];
          const metadataIntents: MetadataIntent[] = [];
          for (const row of validation.rows) {
            let parentObjectId: string | null = null;
            let inheritedAddress: string | null = null;
            let inheritedCity: string | null = null;
            let inheritedPostal: string | null = null;
            if (row.parentInterim) {
              const parent = interimMap[row.parentInterim];
              if (!parent) {
                throw new ValidationError(
                  `Förälder försvann under commit (${row.parentInterim})`,
                );
              }
              parentObjectId = parent.objectId === "<pending>" ? null : parent.objectId;
              inheritedAddress = parent.address;
              inheritedCity = parent.city;
              inheritedPostal = parent.postalCode;
            }

            const finalAddress = row.address ?? inheritedAddress;
            const finalCity = row.city ?? inheritedCity;
            const finalPostal = row.postalCode ?? inheritedPostal;

            const [obj] = await tx
              .insert(objects)
              .values({
                tenantId,
                parentId: parentObjectId,
                name: row.name,
                objectNumber: row.objectNumber ?? null,
                objectType: step === 3 ? "karl" : step === 2 ? "fastighet" : "omrade",
                hierarchyLevel: row.hierarchyLevel ?? hierarchyDefaultByStep[step],
                address: finalAddress,
                city: finalCity,
                postalCode: finalPostal,
                importBatchId: batchId,
              } as any)
              .returning();
            createdIds.push(obj.id);

            if (row.metadata) {
              metadataIntents.push({
                objectId: obj.id,
                parentObjectId,
                metadata: row.metadata,
              });
            }

            if (row.interim) {
              interimMap[row.interim] = {
                objectId: obj.id,
                step,
                name: row.name,
                address: finalAddress,
                city: finalCity,
                postalCode: finalPostal,
              };
            }
          }

          // Spec: import_batches återanvänds som "lager" för wizard-batchar med session_id-koppling.
          await tx.insert(importBatches).values({
            tenantId,
            batchId,
            sessionId: session.id,
            totalRows: validation.rows.length,
            created: createdIds.length,
            updated: 0,
            errors: 0,
            metadata: { wizardStep: step } as any,
          } as any);

          const createdCounts: Record<string, number> = {
            ...((session.createdCounts as Record<string, number>) ?? {}),
            [`step${step}`]: createdIds.length,
          };
          const newStatus = step === 3 ? "completed" : "in_progress";
          const [updated] = await tx
            .update(importSessions)
            .set({
              stepCompleted: step,
              interimMap: interimMap as any,
              createdCounts: createdCounts as any,
              status: newStatus,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(importSessions.id, session.id),
                eq(importSessions.tenantId, tenantId),
                eq(importSessions.stepCompleted, session.stepCompleted),
              ),
            )
            .returning();
          if (!updated) {
            throw new ValidationError(
              "Sessionen ändrades under commit. Försök igen.",
            );
          }
          return { createdIds, updated, metadataIntents };
        });

        // Metadata skrivs EFTER att objekt-transaktionen committats: helpern
        // (writeObjectImportMetadataBatch) använder modul-nivå `db` och kör en
        // rekursiv CTE mot `objects` för nivå-lås — den måste se committade
        // rader. Skrivningen är best-effort: objekt rullas aldrig tillbaka pga
        // metadata-fel, varningar returneras istället i `metadataWarnings`.
        const userId = (req as any).user?.claims?.sub ?? (req as any).user?.id ?? undefined;
        const metadataWarnings = await writeWizardMetadata(
          tenantId,
          result.metadataIntents,
          userId,
        );

        res.json({
          ok: true,
          step,
          created: result.createdIds.length,
          ids: result.createdIds,
          batchId,
          failures: [],
          metadataWarnings,
          session: result.updated,
        });
      } catch (err: any) {
        if (err instanceof ValidationError) throw err;
        // Returnera 400 med radfel-info så frontend kan visa orsak utan att krascha.
        return res.status(400).json({
          ok: false,
          step,
          created: 0,
          ids: [],
          batchId,
          failures: [{ index: -1, message: err?.message ?? String(err) }],
        });
      }
    }),
  );

  // === Abandon ==============================================================
  app.post(
    "/api/import/wizard/sessions/:id/abandon",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const [session] = await db
        .select()
        .from(importSessions)
        .where(and(eq(importSessions.id, req.params.id), eq(importSessions.tenantId, tenantId)));
      if (!session) throw new NotFoundError("Import-session");
      await db
        .update(importSessions)
        .set({ status: "abandoned", updatedAt: new Date() })
        .where(and(eq(importSessions.id, session.id), eq(importSessions.tenantId, tenantId)));
      res.json({ ok: true });
    }),
  );
}
