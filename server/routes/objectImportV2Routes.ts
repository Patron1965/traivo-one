// Import 2.0 — session-baserat 5-stegsflöde för objektimport.
//
// Endpoints (namespace /api/import/objects-v2/* för att inte skugga befintliga
// /api/import/* eller wizard-flödet — additivt, bryter inte modus/wizard):
//   POST   /api/import/objects-v2/upload            skapa session (draft) + auto-matcha kolumner
//   GET    /api/import/objects-v2/:id               hämta session + status
//   GET    /api/import/objects-v2/:id/preview       kolumner + auto-match + första 10 rader
//   PUT    /api/import/objects-v2/:id/mappings      spara kolumn→fält-mappning
//   POST   /api/import/objects-v2/:id/validate      kör validering, returnera sammanfattning
//   GET    /api/import/objects-v2/:id/validation    hämta valideringsresultat
//   POST   /api/import/objects-v2/:id/execute       bygg hierarki (requireAdmin)
//   GET    /api/import/objects-v2/:id/status        poll status/progress
//   GET    /api/import/objects-v2/:id/result        hämta slutresultat
//   GET    /api/import/objects-v2/fields            fält-katalog (+ tenant-metadata) för "Matcha data"
//
// Multi-tenant: alla SELECT/INSERT/UPDATE har tenant_id i WHERE.
// createObject anropas per rad UTAN yttre transaktion (advisory-lock-deadlock-risk).

import type { Express, Request } from "express";
import { z } from "zod";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { asyncHandler } from "../asyncHandler";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { getTenantIdWithFallback, requireAdmin } from "../tenant-middleware";
import { db } from "../db";
import {
  customers,
  importActions,
  importBatches,
  metadataKatalog,
  metadataVarden,
  objectImportRows,
  objectImportSessions,
  objectParents,
  objects,
  type MetadataKatalog,
} from "@shared/schema";
import {
  ensurePrimaryPayer as ensurePrimaryCustomerMetadata,
  getObjectsPrimaryCustomerIds,
} from "../services/object-customer";
import { storage } from "../storage";
import { isInterimKatalogNamn, writeObjectImportMetadataBatch } from "../metadata-queries";
import {
  IMPORT_UNDO_WINDOW_MS,
  objectSnapshotColumns,
  type ObjectSnapshot,
} from "../services/import-undo";
import {
  buildColumns,
  buildMetadataHeaderAliases,
  buildCompositeObject,
  groupMetadataForWrite,
  buildHierarchyPlan,
  categoryForTarget,
  detectHeaderRows,
  resolveRow,
  validateCrossRow,
  validateRow,
  type ResolvedRow,
} from "../services/object-import-core";
import {
  ColumnMappings,
  FIELD_CATALOG,
  FieldDefinition,
  parseActiveStatus,
} from "@shared/object-import-spec";
import { archivePreflight } from "../services/object-archive";
import {
  findImportDuplicateWarnings,
  type ImportDuplicateWarning,
} from "../services/object-duplicates";
import {
  OBJEKTMALL_INTERIM_METADATA_FALT,
  OBJEKTMALL_INTERIM_PREFIX,
} from "@shared/objektmall-template";
import { classifyExecuteRowNotes } from "../services/import-result-notes";

function getUserId(req: Request): string | null {
  return (req as any).user?.claims?.sub ?? (req as any).user?.id ?? null;
}

type DetectedColumn = ReturnType<typeof buildColumns>[number];
type RawRow = Record<string, string>;

// Bygg en auto-mappning från detekterade kolumner.
function autoMappings(columns: DetectedColumn[]): ColumnMappings {
  const mappings: ColumnMappings = {};
  for (const col of columns) {
    if (!col.autoMatch) continue;
    // Task #1478: auto-ignorerade kolumner (t.ex. "Släktnamn" → __empty)
    // persisteras som explicit __empty-mappning så att de inte falskflaggas
    // som omatchade i valideringens unmapped_columns.
    if (col.autoMatch === "__empty") {
      mappings[String(col.index)] = { target: "__empty", type: "standard" };
      continue;
    }
    mappings[String(col.index)] = {
      target: col.autoMatch,
      type: categoryForTarget(col.autoMatch),
      required: col.autoMatch === "name",
    };
  }
  return mappings;
}

async function loadSession(id: string, tenantId: string) {
  const [session] = await db
    .select()
    .from(objectImportSessions)
    .where(and(eq(objectImportSessions.id, id), eq(objectImportSessions.tenantId, tenantId)));
  if (!session) throw new NotFoundError("Importsessionen hittades inte.");
  return session;
}

const uploadSchema = z.object({
  fileName: z.string().trim().max(255).optional(),
  // Hela kalkylbladet som matris (inkl. header-rader). Klienten parsar xlsx/csv.
  matrix: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).max(50000),
});

const mappingsSchema = z.object({
  mappings: z.record(
    z.string(),
    z.object({
      target: z.string().trim().min(1).max(120),
      type: z.enum(["standard", "address", "contact", "metadata"]),
      required: z.boolean().optional(),
    }),
  ),
});

const executeSchema = z.object({
  customerId: z.string().trim().max(64).optional(),
  skipRowNumbers: z.array(z.number().int()).max(50000).optional(),
  // Opt-in: skriv över redan lagrade metadatavärden på BEFINTLIGA objekt med
  // importens värden (äkta export → redigera → importera). Default false =
  // bakåtkompatibelt "första-skrivningen-vinner" (befintliga värden bevaras).
  overwriteMetadata: z.boolean().optional(),
  // Task #1478: uttryckligt kvitto på att kolumner med data som saknar mappning
  // INTE importeras. Krävs av servern när valideringens unmapped_columns är
  // icke-tom — UI-checkboxen är bara spegeln av detta fält.
  acknowledgeUnmappedColumns: z.boolean().optional(),
});

// Task #1430 — systemfält som behövs för matchning (egen grupp i "Matcha data").
const SYSTEM_MATCH_KEYS = new Set([
  "system_id",
  "system_parent_id",
  "interim_id",
  "interim_parent_id",
]);

function toCell(v: string | number | boolean | null): string {
  if (v == null) return "";
  return String(v).trim();
}

export function registerObjectImportV2Routes(app: Express): void {
  // ── /fields — fält-katalog för "Matcha data"-dialogen (inkl. tenant-metadata)
  app.get(
    "/api/import/objects-v2/fields",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const q = String(req.query.q ?? "").trim().toLowerCase();

      // Task #1430 — Tenant-definierade metadatafält → metadata.<namn>.
      // Endast DEFINIERADE, AKTIVA katalograder: arkiverade (deleted_at satt)
      // och trasiga rader (tomt namn) filtreras bort ur väljaren. Lagrade
      // värden/historik på objekt påverkas inte — endast val-listan.
      const katalog = await db
        .select({
          id: metadataKatalog.id,
          namn: metadataKatalog.namn,
          visningsnamn: metadataKatalog.visningsnamn,
          beskrivning: metadataKatalog.beskrivning,
          datatyp: metadataKatalog.datatyp,
          area: metadataKatalog.area,
          displayNumber: metadataKatalog.displayNumber,
          sortOrder: metadataKatalog.sortOrder,
          parentMetadataId: metadataKatalog.parentMetadataId,
        })
        .from(metadataKatalog)
        .where(and(eq(metadataKatalog.tenantId, tenantId), isNull(metadataKatalog.deletedAt)));
      const active = katalog.filter((k) => (k.namn ?? "").trim() !== "");
      const byId = new Map(active.map((k) => [k.id, k]));
      const metadataFields: FieldDefinition[] = active.map((k) => {
        // Förälder räknas bara om den själv är aktiv (arkiverad förälder ⇒ barnet
        // visas som fristående fält istället för föräldralös indentering).
        const parent = k.parentMetadataId ? byId.get(k.parentMetadataId) : undefined;
        const display = (k.visningsnamn ?? "").trim() || k.namn.replace(/_/g, " ");
        return {
          key: `metadata.${k.namn}`,
          label: display,
          description: k.beskrivning ?? "Definierat metadatafält",
          category: "metadata",
          type: "text",
          required: false,
          group: "metadata",
          area: (parent?.area ?? k.area) ?? null,
          datatyp: k.datatyp ?? "string",
          namn: k.namn,
          isChild: !!parent,
          parentKey: parent ? `metadata.${parent.namn}` : undefined,
          displayNumber: k.displayNumber ?? null,
          sortOrder: k.sortOrder ?? null,
        };
      });

      // Systemfälten som behövs för matchning — egen grupp i väljaren.
      const systemFields: FieldDefinition[] = FIELD_CATALOG.filter((f) =>
        SYSTEM_MATCH_KEYS.has(f.key),
      ).map((f) => ({ ...f, group: "system" }));

      // Task #1430: väljaren erbjuder ENDAST (1) systemfälten för matchning och
      // (2) definierade metadatafält. Övriga inbyggda fält (objektnamn, kund,
      // adress, kontakt, __empty …) utgår ur val-listan — den tekniska
      // mappningen bakom kulisserna (auto-matchning/execute mot t.ex. "name")
      // finns kvar och redan matchade kolumner fortsätter fungera.
      let all = [...systemFields, ...metadataFields];
      if (q) {
        all = all.filter(
          (f) =>
            f.key.toLowerCase().includes(q) ||
            f.label.toLowerCase().includes(q) ||
            (f.description ?? "").toLowerCase().includes(q),
        );
      }
      res.json({ fields: all });
    }),
  );

  // ── POST /upload — skapa session + auto-matcha
  app.post(
    "/api/import/objects-v2/upload",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const userId = getUserId(req);
      const parsed = uploadSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("Ogiltig uppladdning.");

      const matrix: string[][] = parsed.data.matrix.map((row) => row.map(toCell));
      const detection = detectHeaderRows(matrix);
      const systemHeaders = matrix[detection.systemHeaderRow] ?? [];
      const userHeaders = detection.userHeaderRow != null ? matrix[detection.userHeaderRow] ?? [] : [];
      // Task #1478: auto-matcha även mot tenantens AKTIVA metadata-katalog
      // (namn/visningsnamn + kända kundrubrik-synonymer) så att rubriker som
      // "Tömningsdag", "Objekt typ" eller "Region" inte lämnas omatchade.
      const aktivKatalog = await db
        .select({ namn: metadataKatalog.namn, visningsnamn: metadataKatalog.visningsnamn })
        .from(metadataKatalog)
        .where(and(eq(metadataKatalog.tenantId, tenantId), isNull(metadataKatalog.deletedAt)));
      const metadataAliases = buildMetadataHeaderAliases(
        aktivKatalog.filter((k) => !isInterimKatalogNamn(k.namn)),
      );
      const columns = buildColumns(systemHeaders, userHeaders, metadataAliases);

      const dataRows = matrix.slice(detection.dataStartRow);
      const rawRows: RawRow[] = dataRows
        .map((row) => {
          const obj: RawRow = {};
          for (const col of columns) obj[String(col.index)] = row[col.index] ?? "";
          return obj;
        })
        // Hoppa över helt tomma rader.
        .filter((r) => Object.values(r).some((v) => v.trim() !== ""));

      const mappings = autoMappings(columns);

      const [session] = await db
        .insert(objectImportSessions)
        .values({
          tenantId,
          fileName: parsed.data.fileName ?? null,
          status: "mapping",
          columns: columns as any,
          rawRows: rawRows as any,
          mappings: mappings as any,
          createdBy: userId,
        })
        .returning();

      res.json({
        session_id: session.id,
        status: session.status,
        file_name: session.fileName,
        columns,
        total_rows: rawRows.length,
        preview_rows: rawRows.slice(0, 10),
        mappings,
      });
    }),
  );

  // ── GET /:id — session + status
  app.get(
    "/api/import/objects-v2/:id",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const session = await loadSession(req.params.id, tenantId);
      const rawRows = (session.rawRows as RawRow[]) ?? [];
      res.json({
        session_id: session.id,
        status: session.status,
        progress: session.progress,
        file_name: session.fileName,
        columns: session.columns,
        mappings: session.mappings,
        total_rows: rawRows.length,
        preview_rows: rawRows.slice(0, 10),
        validation: session.validation ?? null,
        result: session.result ?? null,
      });
    }),
  );

  // ── GET /:id/preview — kolumner + auto-match + datapreview
  app.get(
    "/api/import/objects-v2/:id/preview",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const session = await loadSession(req.params.id, tenantId);
      const rawRows = (session.rawRows as RawRow[]) ?? [];
      res.json({
        columns: session.columns,
        mappings: session.mappings,
        total_rows: rawRows.length,
        preview_rows: rawRows.slice(0, 10),
      });
    }),
  );

  // Task #1478: kanonisk representation av mappningarna (sorterade nycklar).
  // Valideringen persisterar snapshoten av de mappningar den räknade på, och
  // execute godkänner bara valideringen om sessionens AKTUELLA mappningar
  // matchar — då är gaten revision-säker även om PUT /mappings och POST
  // /validate interfolieras (stale validering avvisas alltid).
  const canonicalMappings = (mappings: ColumnMappings): string =>
    JSON.stringify(
      Object.keys(mappings)
        .sort()
        .map((k) => {
          const m = mappings[k] as unknown as Record<string, unknown>;
          return [k, Object.keys(m).sort().map((f) => [f, m[f]])];
        }),
    );

  // ── PUT /:id/mappings — spara mappningar
  app.put(
    "/api/import/objects-v2/:id/mappings",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      await loadSession(req.params.id, tenantId);
      const parsed = mappingsSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("Ogiltiga mappningar.");

      const [updated] = await db
        .update(objectImportSessions)
        // Task #1478: ändrade mappningar gör tidigare valideringsresultat
        // inaktuellt — rensa det så att sammanfattningen aldrig visar gammal data.
        .set({ mappings: parsed.data.mappings as any, status: "mapping", validation: null, updatedAt: new Date() })
        .where(and(eq(objectImportSessions.id, req.params.id), eq(objectImportSessions.tenantId, tenantId)))
        .returning();
      res.json({ session_id: updated.id, mappings: updated.mappings, status: updated.status });
    }),
  );

  // ── POST /:id/validate — kör validering
  app.post(
    "/api/import/objects-v2/:id/validate",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const session = await loadSession(req.params.id, tenantId);
      const mappings = (session.mappings as ColumnMappings) ?? {};
      const rawRows = (session.rawRows as RawRow[]) ?? [];
      if (Object.keys(mappings).length === 0) {
        throw new ValidationError("Inga kolumnmappningar sparade — matcha kolumner först.");
      }

      // Per-rad-validering (typ + obligatoriskt).
      const perRow = rawRows.map((raw, i) => validateRow(i + 1, raw, mappings));
      // Korsrad-validering (förälderkonsistens, cirkulär, dubbletter).
      const resolved: ResolvedRow[] = rawRows.map((raw, i) => resolveRow(i + 1, raw, mappings));
      const cross = validateCrossRow(resolved);

      // Slå ihop korsrad-issues in i per-rad.
      const byRow = new Map(perRow.map((r) => [r.rowNumber, r]));
      for (const c of cross) {
        const row = byRow.get(c.rowNumber);
        if (!row) continue;
        row.issues.push({ field: c.field, message: c.message, severity: c.severity });
        if (c.severity === "error") row.status = "invalid";
        else if (row.status === "valid") row.status = "warning";
      }

      // §5.2 DB-referenskontroll: Systemföräldranummer måste peka på ett
      // FAKTISKT befintligt objekt i Traivo (tenant-scopat). Ett system_parent_id
      // får ALDRIG accepteras enbart för att en annan rad i filen råkar ha samma
      // värde i sin system_id-kolumn — den kolumnen är fri text och kan vara
      // påhittad. Om den inte finns i DB kan execute (objectNumberToId) inte
      // resolva föräldern och barnet skulle tyst importeras som rot. Endast
      // verklig DB-existens (existingParents) släpper igenom.
      const sysParentIds = Array.from(
        new Set(resolved.map((r) => r.fields.system_parent_id).filter(Boolean) as string[]),
      );
      if (sysParentIds.length) {
        const found = await db
          .select({ objectNumber: objects.objectNumber })
          .from(objects)
          .where(and(eq(objects.tenantId, tenantId), inArray(objects.objectNumber, sysParentIds)));
        const existingParents = new Set<string>();
        for (const f of found) if (f.objectNumber) existingParents.add(f.objectNumber);
        for (const r of resolved) {
          const sp = r.fields.system_parent_id;
          if (!sp || existingParents.has(sp)) continue;
          const row = byRow.get(r.rowNumber);
          if (!row) continue;
          // Task #1356: saknad systemförälder stoppar inte importen — raden
          // blir en topphierarki (rot). Varning informerar användaren, som kan
          // bocka i "hoppa över" om raden inte ska importeras alls.
          row.issues.push({
            field: "system_parent_id",
            message: `Systemföräldranummer "${sp}" finns inte i Traivo — raden importeras som topphierarki (rot)`,
            severity: "warning",
          });
          if (row.status === "valid") row.status = "warning";
        }
      }

      // §5.3 Kund-referenskontroll (varning, ej blockerande): om en kund-kolumn
      // är mappad och ett rad-värde inte matchar någon kund i Traivo faller raden
      // tillbaka utan kundkoppling vid execute (ingen standardkund, Task #1437).
      // Varna så användaren ser det innan
      // körning istället för att tyst hamna under fel kund.
      const hasCustomerMapping = Object.values(mappings).some(
        (m) => m.target === "customer_name" || m.target === "customer_ref",
      );
      if (hasCustomerMapping) {
        const activeCustomers = await db
          .select({ name: customers.name, customerNumber: customers.customerNumber, orgNumber: customers.orgNumber })
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)));
        const nameSet = new Set<string>();
        const refSet = new Set<string>();
        for (const c of activeCustomers) {
          if (c.name) nameSet.add(c.name.trim().toLowerCase());
          if (c.customerNumber) refSet.add(c.customerNumber.trim().toLowerCase());
          if (c.orgNumber) refSet.add(c.orgNumber.trim().toLowerCase());
        }
        for (const r of resolved) {
          const ref = (r.fields.customer_ref ?? "").trim().toLowerCase();
          const name = (r.fields.customer_name ?? "").trim().toLowerCase();
          if (!ref && !name) continue;
          const matched = (ref && refSet.has(ref)) || (name && nameSet.has(name));
          if (matched) continue;
          const row = byRow.get(r.rowNumber);
          if (!row) continue;
          const label = r.fields.customer_ref || r.fields.customer_name || "";
          row.issues.push({
            field: ref ? "customer_ref" : "customer_name",
            message: `Kund "${label}" hittades inte — objektet importeras utan kundkoppling (om ingen kund väljs vid körningen)`,
            severity: "warning",
          });
          if (row.status === "valid") row.status = "warning";
        }
      }

      // Feature 2: dubblettvarning — flagga rader vars namn+adress krockar med
      // BEFINTLIGA aktiva objekt. Endast icke-blockerade rader (ej "invalid").
      // Adressen byggs precis som vid execute (buildKnownFields) så varningen
      // jämför mot exakt det värde som skulle skrivas till objects.address.
      // Självträff på system-/externt nummer (raden uppdaterar objektet) filtreras
      // bort i findImportDuplicateWarnings. Rent informativt; blockerar ej import.
      const dupCandidates = resolved
        .filter((r) => byRow.get(r.rowNumber)?.status !== "invalid")
        .map((r) => {
          const addr = buildCompositeObject(r.composite.address ?? {});
          const street = [addr.street, addr.street_number].filter(Boolean).join(" ").trim();
          const effectiveAddress = (r.fields["address.full"] ?? street) || null;
          return {
            rowNumber: r.rowNumber,
            name: (r.fields.name ?? "").trim(),
            address: effectiveAddress,
            selfObjectNumbers: [r.fields.system_id, r.fields.external_id],
          };
        });
      const duplicateWarnings: ImportDuplicateWarning[] = await findImportDuplicateWarnings(
        tenantId,
        dupCandidates,
      );
      // Lägg in en per-rad-varning (severity "warning") så varje berörd rad
      // flaggas inline i valideringstabellen (samma rendering som övriga issues).
      const dupRows = new Set<number>();
      for (const w of duplicateWarnings) for (const rn of w.rowNumbers) dupRows.add(rn);
      for (const rn of Array.from(dupRows)) {
        const row = byRow.get(rn);
        if (!row) continue;
        row.issues.push({
          field: "name",
          message:
            "Möjlig dubblett: ett aktivt objekt med samma namn och adress finns redan. Överväg arkivering eller öppna dubbletthantering.",
          severity: "warning",
        });
        if (row.status === "valid") row.status = "warning";
      }

      // Feature 3: aktivstatus-förhandsvisning. Visa per rad om importen kommer
      // att arkivera eller återställa objektet. Arkivering flaggas alltid (den är
      // konsekvensbärande). Återställning flaggas ENDAST när det matchade objektet
      // faktiskt är arkiverat just nu — annars vore varje "aktiv"-rad en falsk
      // varning på en normal fil. Okänt värde flaggas så användaren ser att det
      // ignoreras. Auktoritativ blockering (aktiva underobjekt) sker i execute.
      const activeRows = resolved.filter(
        (r) => parseActiveStatus(r.fields.active_status) === "active",
      );
      const archivedSystem = new Set<string>();
      const archivedInterim = new Set<string>();
      const archivedExternal = new Set<string>();
      if (activeRows.length) {
        const sysIds = Array.from(
          new Set(activeRows.map((r) => r.fields.system_id).filter(Boolean) as string[]),
        );
        const intIds = Array.from(
          new Set(activeRows.map((r) => r.fields.interim_id).filter(Boolean) as string[]),
        );
        const extIds = Array.from(
          new Set(activeRows.map((r) => r.fields.external_id).filter(Boolean) as string[]),
        );
        const numberLookup = [...sysIds, ...intIds.map((i) => OBJEKTMALL_INTERIM_PREFIX + i)];
        if (numberLookup.length) {
          const rowsA = await db
            .select({ objectNumber: objects.objectNumber, deletedAt: objects.deletedAt })
            .from(objects)
            .where(and(eq(objects.tenantId, tenantId), inArray(objects.objectNumber, numberLookup)));
          for (const r of rowsA) {
            if (!r.objectNumber || r.deletedAt == null) continue;
            if (r.objectNumber.startsWith(OBJEKTMALL_INTERIM_PREFIX)) {
              archivedInterim.add(r.objectNumber.slice(OBJEKTMALL_INTERIM_PREFIX.length));
            } else {
              archivedSystem.add(r.objectNumber);
            }
          }
        }
        if (extIds.length) {
          const [extKatalog] = await db
            .select({ id: metadataKatalog.id })
            .from(metadataKatalog)
            .where(and(eq(metadataKatalog.tenantId, tenantId), eq(metadataKatalog.namn, "externt_id")));
          if (extKatalog) {
            const rowsE = await db
              .select({ varde: metadataVarden.vardeString, deletedAt: objects.deletedAt })
              .from(metadataVarden)
              .innerJoin(objects, eq(objects.id, metadataVarden.objektId))
              .where(
                and(
                  eq(metadataVarden.tenantId, tenantId),
                  eq(metadataVarden.status, "aktiv"),
                  eq(metadataVarden.metadataKatalogId, extKatalog.id),
                  inArray(metadataVarden.vardeString, extIds),
                ),
              );
            for (const r of rowsE) if (r.varde && r.deletedAt != null) archivedExternal.add(r.varde);
          }
        }
      }
      for (const r of resolved) {
        const raw = r.fields.active_status;
        if (!raw || !raw.trim()) continue;
        const row = byRow.get(r.rowNumber);
        if (!row || row.status === "invalid") continue;
        const st = parseActiveStatus(raw);
        if (!st) {
          row.issues.push({
            field: "active_status",
            message: `Okänt aktivstatus-värde "${raw}" — ignoreras (objektets status ändras inte).`,
            severity: "warning",
          });
          if (row.status === "valid") row.status = "warning";
          continue;
        }
        if (st === "archived") {
          row.issues.push({
            field: "active_status",
            message: 'Aktivstatus "arkiverad": objektet arkiveras (soft-delete) vid import.',
            severity: "warning",
          });
          if (row.status === "valid") row.status = "warning";
        } else {
          const isArchivedNow =
            (!!r.fields.system_id && archivedSystem.has(r.fields.system_id)) ||
            (!!r.fields.interim_id && archivedInterim.has(r.fields.interim_id)) ||
            (!!r.fields.external_id && archivedExternal.has(r.fields.external_id));
          if (isArchivedNow) {
            row.issues.push({
              field: "active_status",
              message: 'Aktivstatus "aktiv": arkiverat objekt återställs vid import.',
              severity: "warning",
            });
            if (row.status === "valid") row.status = "warning";
          }
        }
      }

      // Feature: metadata-överskrivningsförhandsvisning. För rader som matchar
      // ett BEFINTLIGT objekt (via system_id/external_id) och skriver ersättande
      // metadatafält som redan har ett lagrat värde: visa vilka fält som är
      // berörda. Som standard bevaras dessa (första-skrivningen-vinner); aktivera
      // "Skriv över befintliga värden" i importsteget för att uppdatera dem.
      // Kompletterande fält (allowDuplicates=true) berörs aldrig och listas ej.
      const metaRows = resolved.filter((r) => {
        if (byRow.get(r.rowNumber)?.status === "invalid") return false;
        const { strings, jsonGroups } = groupMetadataForWrite(r.metadata);
        return strings.length > 0 || jsonGroups.length > 0 || !!r.metadata.typ;
      });
      if (metaRows.length) {
        const sysNums = Array.from(
          new Set(metaRows.map((r) => r.fields.system_id).filter(Boolean) as string[]),
        );
        const objByNumber = new Map<string, string>();
        if (sysNums.length) {
          const found = await db
            .select({ id: objects.id, objectNumber: objects.objectNumber })
            .from(objects)
            .where(and(eq(objects.tenantId, tenantId), inArray(objects.objectNumber, sysNums)));
          for (const o of found) if (o.objectNumber) objByNumber.set(o.objectNumber, o.id);
        }
        const targetIds = Array.from(new Set(Array.from(objByNumber.values())));
        // katalogId → namn för icke-kompletterande (ersättande) katalogfält som
        // faktiskt HAR ett värde på något av målobjekten.
        const existingByObject = new Map<string, Set<string>>();
        if (targetIds.length) {
          const existing = await db
            .select({
              objektId: metadataVarden.objektId,
              namn: metadataKatalog.namn,
              allowDuplicates: metadataKatalog.allowDuplicates,
            })
            .from(metadataVarden)
            .innerJoin(metadataKatalog, eq(metadataKatalog.id, metadataVarden.metadataKatalogId))
            .where(and(eq(metadataVarden.tenantId, tenantId), eq(metadataVarden.status, "aktiv"), inArray(metadataVarden.objektId, targetIds)));
          for (const e of existing) {
            if (e.allowDuplicates || !e.objektId) continue;
            if (!existingByObject.has(e.objektId)) existingByObject.set(e.objektId, new Set());
            existingByObject.get(e.objektId)!.add(e.namn);
          }
        }
        for (const r of metaRows) {
          const objId = r.fields.system_id ? objByNumber.get(r.fields.system_id) : undefined;
          if (!objId) continue; // nytt objekt → inget att skriva över
          const existingNames = existingByObject.get(objId);
          if (!existingNames || existingNames.size === 0) continue;
          const { strings, jsonGroups } = groupMetadataForWrite(r.metadata);
          const rowNames = new Set<string>();
          for (const s of strings) rowNames.add(s.namn);
          for (const g of jsonGroups) rowNames.add(g.namn);
          if (r.metadata.typ) rowNames.add("Objekttyp"); // Task #1484: kanoniskt klassificeringsfält
          const collisions = Array.from(rowNames).filter((n) => existingNames.has(n));
          if (collisions.length === 0) continue;
          const row = byRow.get(r.rowNumber);
          if (!row) continue;
          row.issues.push({
            field: "metadata",
            message: `Metadatafält med befintligt värde: ${collisions.join(", ")}. Bevaras som standard — aktivera "Skriv över befintliga värden" i importsteget för att uppdatera dem.`,
            severity: "warning",
          });
          if (row.status === "valid") row.status = "warning";
        }
      }

      // Task #1478: omatchade kolumner får ALDRIG tappas tyst. Lista kolumner
      // som (a) saknar mappning (explicit "__empty" = medvetet ignorerad och
      // räknas inte) och (b) faktiskt innehåller data i någon rad.
      const sessionColumns = (session.columns as { index: number; header: string | null; userHeader: string | null }[]) ?? [];
      const unmappedColumns = sessionColumns
        .filter((c) => {
          const m = mappings[String(c.index)];
          if (m && m.target && m.target !== "__empty") return false;
          if (m && m.target === "__empty") return false; // medvetet ignorerad
          return rawRows.some((r) => (r[String(c.index)] ?? "").trim() !== "");
        })
        .map((c) => ({
          index: c.index,
          header: c.userHeader || c.header || `Kolumn ${c.index + 1}`,
        }));

      // Task #1478: mappade metadata-fält vars katalogpost är ARKIVERAD skulle
      // annars skrivas osynligt (värdena filtreras bort i alla läsvägar).
      // Flagga dem — vid execute återställs (avarkiveras) fältet så värdena syns.
      const mappedMetadataNames = Array.from(
        new Set(
          Object.values(mappings)
            .filter((m) => m.target.startsWith("metadata.") && !m.target.slice("metadata.".length).includes("."))
            .map((m) => m.target.slice("metadata.".length)),
        ),
      );
      let archivedMetadataFields: string[] = [];
      if (mappedMetadataNames.length) {
        const katRows = await db
          .select({ namn: metadataKatalog.namn, deletedAt: metadataKatalog.deletedAt })
          .from(metadataKatalog)
          .where(and(eq(metadataKatalog.tenantId, tenantId), inArray(metadataKatalog.namn, mappedMetadataNames)));
        // Ett namn räknas som arkiverat ENDAST om ingen aktiv rad finns
        // (katalogen kan ha en arkiverad klon + en aktiv rad med samma namn).
        const activeNames = new Set(katRows.filter((k) => k.deletedAt == null).map((k) => k.namn));
        archivedMetadataFields = Array.from(
          new Set(katRows.filter((k) => k.deletedAt != null && !activeNames.has(k.namn)).map((k) => k.namn)),
        );
      }

      const rows = Array.from(byRow.values());
      const summary = {
        total_rows: rows.length,
        valid: rows.filter((r) => r.status === "valid").length,
        warning: rows.filter((r) => r.status === "warning").length,
        invalid: rows.filter((r) => r.status === "invalid").length,
        // Task #1356: rader vars förälder inte kunde hittas — de importeras
        // som nya toppnivåer (rot) om de inte hoppas över.
        new_roots: rows.filter(
          (r) =>
            r.status !== "invalid" &&
            r.issues.some(
              (i: any) =>
                i.severity === "warning" &&
                (i.field === "interim_parent_id" || i.field === "system_parent_id"),
            ),
        ).length,
        // Task #1478: kolumner med data som inte importeras + arkiverade
        // metadata-mål (återställs vid execute) — visas i wizardens sammanfattning.
        unmapped_columns: unmappedColumns,
        archived_metadata_fields: archivedMetadataFields,
      };
      const validation = {
        summary,
        rows,
        duplicateWarnings,
        // Task #1478: bind valideringen till exakt de mappningar den räknades på.
        mappingsSnapshot: canonicalMappings(mappings),
      };

      // §6.1 ImportRow: persistera per-rad-livscykel (pending → valid/invalid).
      // Skriv om hela radmängden för sessionen (delete + bulk-insert) så att
      // omvalidering speglar senaste mappning. invalid → "invalid", övriga
      // (valid/warning) → "valid"; varningar bevaras i validationMsgs.
      const rowRecords = rows.map((r) => ({
        sessionId: req.params.id,
        tenantId,
        rowNumber: r.rowNumber,
        rawData: (rawRows[r.rowNumber - 1] ?? {}) as any,
        status: r.status === "invalid" ? "invalid" : "valid",
        validationMsgs: (r.issues ?? []) as any,
      }));
      await db.transaction(async (tx) => {
        // Serialisera samtidiga validate-anrop på samma session: lås session-raden
        // så att delete+insert inte tävlar mot uniq (session_id,row_number).
        await tx.execute(
          sql`SELECT id FROM object_import_sessions WHERE id = ${req.params.id} AND tenant_id = ${tenantId} FOR UPDATE`,
        );
        await tx
          .delete(objectImportRows)
          .where(and(eq(objectImportRows.sessionId, req.params.id), eq(objectImportRows.tenantId, tenantId)));
        for (let i = 0; i < rowRecords.length; i += 500) {
          await tx.insert(objectImportRows).values(rowRecords.slice(i, i + 500));
        }
        await tx
          .update(objectImportSessions)
          .set({ validation: validation as any, status: "validating", updatedAt: new Date() })
          .where(and(eq(objectImportSessions.id, req.params.id), eq(objectImportSessions.tenantId, tenantId)));
      });

      res.json(validation);
    }),
  );

  // ── GET /:id/validation
  app.get(
    "/api/import/objects-v2/:id/validation",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const session = await loadSession(req.params.id, tenantId);
      res.json(session.validation ?? { summary: null, rows: [] });
    }),
  );

  // ── GET /:id/status — poll
  app.get(
    "/api/import/objects-v2/:id/status",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const session = await loadSession(req.params.id, tenantId);
      res.json({ status: session.status, progress: session.progress, error: session.error ?? null });
    }),
  );

  // ── GET /:id/result
  app.get(
    "/api/import/objects-v2/:id/result",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const session = await loadSession(req.params.id, tenantId);
      const result = (session.result as Record<string, unknown> | null) ?? null;
      if (!result) {
        res.json(null);
        return;
      }

      // Task #1364: lista VILKA rader som blev nya toppnivåer (became_roots)
      // resp. kaskad-hoppade utrustningsrader. Datat kommer från de redan
      // persisterade radnoteringarna (validationMsgs, field="execute") som
      // execute stämplade — ingen ny beräkning.
      const summary = (result.summary ?? {}) as { became_roots?: number; skipped_missing_parent?: number };
      if ((summary.became_roots ?? 0) > 0 || (summary.skipped_missing_parent ?? 0) > 0) {
        type ExecMsg = { field?: string; message?: string; severity?: string; code?: string };
        const rows = await db
          .select({
            rowNumber: objectImportRows.rowNumber,
            status: objectImportRows.status,
            validationMsgs: objectImportRows.validationMsgs,
            objectId: objectImportRows.objectId,
            rawData: objectImportRows.rawData,
            objectName: objects.name,
          })
          .from(objectImportRows)
          .leftJoin(
            objects,
            and(eq(objects.id, objectImportRows.objectId), eq(objects.tenantId, tenantId)),
          )
          .where(
            and(
              eq(objectImportRows.sessionId, req.params.id),
              eq(objectImportRows.tenantId, tenantId),
            ),
          )
          .orderBy(objectImportRows.rowNumber);

        // Namn för hoppade rader (inget objekt skapades): läs rå-cellen i den
        // kolumn som mappats till "name".
        const mappings = (session.mappings as ColumnMappings) ?? {};
        const nameColIndex = Object.entries(mappings).find(([, m]) => m.target === "name")?.[0] ?? null;

        const { becameRootRows, skippedEquipmentRows } = classifyExecuteRowNotes(
          rows.map((r) => ({
            rowNumber: r.rowNumber,
            status: r.status,
            validationMsgs: (r.validationMsgs as ExecMsg[] | null) ?? null,
            objectId: r.objectId ?? null,
            objectName: r.objectName ?? null,
            rawData: r.rawData,
          })),
          nameColIndex,
        );
        res.json({ ...result, became_root_rows: becameRootRows, skipped_equipment_rows: skippedEquipmentRows });
        return;
      }
      res.json(result);
    }),
  );

  // ── GET /:id/rows — persistent per-rad-livscykel (§6.1 ImportRow)
  app.get(
    "/api/import/objects-v2/:id/rows",
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      await loadSession(req.params.id, tenantId); // tenant-/existens-kontroll
      const rows = await db
        .select({
          rowNumber: objectImportRows.rowNumber,
          status: objectImportRows.status,
          validationMsgs: objectImportRows.validationMsgs,
          objectId: objectImportRows.objectId,
          rawData: objectImportRows.rawData,
        })
        .from(objectImportRows)
        .where(
          and(
            eq(objectImportRows.sessionId, req.params.id),
            eq(objectImportRows.tenantId, tenantId),
          ),
        )
        .orderBy(objectImportRows.rowNumber);
      const counts = rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {});
      res.json({ total: rows.length, counts, rows });
    }),
  );

  // ── POST /:id/execute — bygg hierarki (requireAdmin: skapar/uppdaterar objekt)
  app.post(
    "/api/import/objects-v2/:id/execute",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const tenantId = getTenantIdWithFallback(req);
      const userId = getUserId(req);
      const session = await loadSession(req.params.id, tenantId);
      const parsed = executeSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new ValidationError("Ogiltiga importparametrar.");

      const mappings = (session.mappings as ColumnMappings) ?? {};
      const rawRows = (session.rawRows as RawRow[]) ?? [];
      if (Object.keys(mappings).length === 0) {
        throw new ValidationError("Inga kolumnmappningar — matcha kolumner och validera först.");
      }

      // Task #1478: serverauktoritativ gate mot tyst datatapp. Execute kräver en
      // AKTUELL validering (PUT /mappings nollar session.validation, så en
      // sparad validering är alltid bunden till gällande mappningar). Om
      // valideringen flaggar kolumner med data utan mappning krävs dessutom ett
      // uttryckligt kvitto i request-bodyn — UI-vägen kan inte förbigås via API.
      const storedValidation = session.validation as
        | {
            summary?: { unmapped_columns?: Array<{ index: number; header: string }> };
            mappingsSnapshot?: string;
          }
        | null;
      if (!storedValidation?.summary) {
        throw new ValidationError("Ingen aktuell validering — kör validering efter senaste mappningsändring.");
      }
      // Revision-check: valideringen måste vara räknad på exakt de mappningar
      // sessionen har NU (skyddar mot interfolierad PUT /mappings ↔ validate).
      if (storedValidation.mappingsSnapshot !== canonicalMappings(mappings)) {
        throw new ValidationError("Valideringen gjordes mot äldre mappningar — kör validering igen.");
      }
      const unmappedWithData = storedValidation.summary.unmapped_columns ?? [];
      if (unmappedWithData.length > 0 && parsed.data.acknowledgeUnmappedColumns !== true) {
        throw new ValidationError(
          `Kolumner med data importeras inte: ${unmappedWithData.map((c) => c.header).join(", ")}. ` +
            "Mappa kolumnerna eller bekräfta uttryckligen att de ska hoppas över (acknowledgeUnmappedColumns).",
        );
      }

      // Task #1437: INGEN automatisk kundkoppling. En kund kopplas ENDAST när
      // den uttryckligen valts (body.customerId, tenant-verifierad) eller när en
      // kund-kolumn är mappad och raden resolverar mot en befintlig kund. Den
      // gamla fallbacken "första aktiva kund i tenant" är borttagen — utan
      // uttrycklig kund skapas objekten helt utan kundkoppling.
      const overwriteMetadata = parsed.data.overwriteMetadata === true;
      const customerId = parsed.data.customerId ?? null;
      if (customerId) {
        const ownCheck = await db.execute(
          sql`SELECT id FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId} AND deleted_at IS NULL LIMIT 1`,
        );
        const ok = (ownCheck as any).rows?.[0] ?? (Array.isArray(ownCheck) ? (ownCheck as any)[0] : null);
        if (!ok) throw new ValidationError("Vald kund tillhör inte denna tenant.");
      }
      const fallbackCustomerId: string | null = customerId;

      // Per-rad kundmappning: om en kolumn mappats till customer_name/customer_ref
      // resolvas kunden per rad mot tenantens kunder (namn / kundnummer / org.nr).
      // Oresolverbara värden ger INGEN kundkoppling (Task #1437) — såvida inte
      // en kund uttryckligen valts i body.customerId.
      const perRowCustomer = Object.values(mappings).some(
        (m) => m.target === "customer_name" || m.target === "customer_ref",
      );
      const customerByName = new Map<string, string>();
      const customerByRef = new Map<string, string>();
      if (perRowCustomer) {
        const allCustomers = await db
          .select({
            id: customers.id,
            name: customers.name,
            customerNumber: customers.customerNumber,
            orgNumber: customers.orgNumber,
          })
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), sql`${customers.deletedAt} IS NULL`));
        for (const c of allCustomers) {
          if (c.name) customerByName.set(c.name.trim().toLowerCase(), c.id);
          if (c.customerNumber) customerByRef.set(c.customerNumber.trim().toLowerCase(), c.id);
          if (c.orgNumber) customerByRef.set(c.orgNumber.trim().toLowerCase(), c.id);
        }
      }
      // Resolverar radens EGNA kundvärde (kundnummer/org.nr → namn). Returnerar
      // null när raden saknar ett eget upplösbart värde, så att callern kan ärva
      // förälderns kund (utrustning/barn) eller lämnas utan kundkoppling.
      const resolveOwnRowCustomerId = (row: ResolvedRow): string | null => {
        if (!perRowCustomer) return null;
        const ref = (row.fields.customer_ref ?? "").trim().toLowerCase();
        if (ref && customerByRef.has(ref)) return customerByRef.get(ref)!;
        const name = (row.fields.customer_name ?? "").trim().toLowerCase();
        if (name && customerByName.has(name)) return customerByName.get(name)!;
        return null;
      };

      // Atomisk gate mot dubbel-exekvering: gå till "importing" endast om
      // sessionen inte redan importerar (compare-and-set). Samtidiga/upprepade
      // execute-anrop får 409 istället för att starta en andra parallell runImport.
      const claimed = await db
        .update(objectImportSessions)
        .set({ status: "importing", progress: 0, error: null, result: null, updatedAt: new Date() })
        .where(
          and(
            eq(objectImportSessions.id, req.params.id),
            eq(objectImportSessions.tenantId, tenantId),
            ne(objectImportSessions.status, "importing"),
          ),
        )
        .returning({ id: objectImportSessions.id });
      if (claimed.length === 0) {
        throw new ConflictError("Import pågår redan för den här sessionen.");
      }

      // Ångra-funktion: stabilt batch-id för hela körningen. Stämplas på skapade
      // objekt (importBatchId) och i import_actions så undo kan rulla tillbaka.
      const batchId = `objects-v2-${req.params.id.slice(0, 8)}-${Date.now()}`;

      // §6.2 steg 5 körs som bakgrundsjobb: svara 202 direkt och låt klienten
      // polla GET /:id/status tills completed/failed och hämta sedan /:id/result.
      const runImport = async () => {
      try {
        // §6.1: säkerställ att varje datarad har en persistent rad — execute kan
        // köras utan föregående validate (endast mappningar krävs). Saknade rader
        // skapas som "pending"; redan persisterade rader (valid/invalid) lämnas
        // orörda via onConflictDoNothing på uniq (session_id,row_number).
        if (rawRows.length) {
          const pendingRows = rawRows.map((raw, i) => ({
            sessionId: req.params.id,
            tenantId,
            rowNumber: i + 1,
            rawData: raw as any,
            status: "pending",
          }));
          for (let i = 0; i < pendingRows.length; i += 500) {
            await db.insert(objectImportRows).values(pendingRows.slice(i, i + 500)).onConflictDoNothing();
          }
        }

        // Hoppa över ogiltiga + uttryckligt skippade rader.
        const skip = new Set(parsed.data.skipRowNumbers ?? []);
        const validation = session.validation as any;
        if (validation?.rows) {
          for (const r of validation.rows) if (r.status === "invalid") skip.add(r.rowNumber);
        }
        // Task #1356: hierarkiplanen (primär/utrustning-klassning per interim-
        // grupp) måste byggas på ALLA rader — annars omklassas en utrustningsrad
        // till primär när användaren hoppar över butiksraden, och skapas tyst
        // som rot. Skippade rader filtreras bort EFTER planeringen istället.
        const resolvedAll: ResolvedRow[] = rawRows.map((raw, i) => resolveRow(i + 1, raw, mappings));
        const resolved: ResolvedRow[] = resolvedAll.filter((r) => !skip.has(r.rowNumber));

        // Befintliga objekt via systemnummer (uppdatera) + externt_id.
        // Slå även upp objekt som refereras som system_parent_id så att en
        // (validerad) DB-existerande förälder ALLTID kan resolvas vid parenting —
        // även om föräldern inte själv är en system_id-rad i filen. Annars skulle
        // ett barn som passerat validering tyst hamna som rot (orphan).
        const systemIds = resolved.map((r) => r.fields.system_id).filter(Boolean) as string[];
        const sysParentNumbers = resolved.map((r) => r.fields.system_parent_id).filter(Boolean) as string[];
        const objectNumberLookup = Array.from(new Set([...systemIds, ...sysParentNumbers]));
        const existingByObjectNumber = new Map<string, string>(); // endast file-system_id → update-matchning
        const existingObjectByNumber = new Map<string, string>(); // alla DB-objekt per nummer → parent-resolution
        if (objectNumberLookup.length) {
          const systemIdSet = new Set(systemIds);
          const rows = await db
            .select({ id: objects.id, objectNumber: objects.objectNumber })
            .from(objects)
            .where(and(eq(objects.tenantId, tenantId), inArray(objects.objectNumber, objectNumberLookup)));
          for (const r of rows) {
            if (!r.objectNumber) continue;
            existingObjectByNumber.set(r.objectNumber, r.id);
            if (systemIdSet.has(r.objectNumber)) existingByObjectNumber.set(r.objectNumber, r.id);
          }
        }

        const externalIds = resolved.map((r) => r.fields.external_id).filter(Boolean) as string[];
        const existingByExternalId = new Map<string, string>();
        if (externalIds.length) {
          const [extKatalog] = await db
            .select({ id: metadataKatalog.id })
            .from(metadataKatalog)
            .where(and(eq(metadataKatalog.tenantId, tenantId), eq(metadataKatalog.namn, "externt_id")));
          if (extKatalog) {
            const rows = await db
              .select({ objektId: metadataVarden.objektId, varde: metadataVarden.vardeString })
              .from(metadataVarden)
              .where(
                and(
                  eq(metadataVarden.tenantId, tenantId),
                  eq(metadataVarden.status, "aktiv"),
                  eq(metadataVarden.metadataKatalogId, extKatalog.id),
                  inArray(metadataVarden.vardeString, externalIds),
                ),
              );
            for (const r of rows) if (r.varde && r.objektId) existingByExternalId.set(r.varde, r.objektId);
          }
        }

        // Befintliga objekt via interimsnummer (3:e prioritet).
        //
        // Task #1433: interimsnumret lagras som metadata ('interimsnummer') och
        // matchas KUNDSKOPAT — samma interimsnummer i listor till OLIKA kunder är
        // OLIKA objekt (återanvända interimnummer får aldrig uppdatera fel kunds
        // objekt). Radens kund vid matchning = radens eget kundvärde → annars
        // den uttryckligen valda kunden, annars kundlös identitet (Task #1437).
        //
        // Bakåtkompat (expand-contract): objekt skapade före Task #1433 har
        // objectNumber MALL-<interim> (v1-konvention) och matchas fortsatt
        // tenant-brett — men bara för interim som inte redan fått en kundskopad
        // träff via metadatat.
        // Task #1433: interim-identiteten är KUNDSKOPAD — samma interimnummer i
        // samma fil till OLIKA kunder är olika objekt. Nyckelrymden för
        // gruppering, matchning och parent-uppslag är `${interim}\u0000${kund}`
        // där radens kund = eget kundvärde → annars vald kund/kundlös.
        // Utrustnings-/barnrader lämnar ofta kundkolumnen tom fast butiksraden
        // anger kund — en rad utan eget kundvärde ärver därför sitt interims
        // ENTYDIGT deklarerade kund (exakt en kund angiven bland raderna med
        // samma interim), annars den uttryckligen valda kunden eller ingen alls.
        const declaredCustByInterim = new Map<string, Set<string>>();
        for (const r of resolvedAll) {
          const interim = r.fields.interim_id;
          if (!interim) continue;
          const own = resolveOwnRowCustomerId(r);
          if (!own) continue;
          (declaredCustByInterim.get(interim) ?? declaredCustByInterim.set(interim, new Set()).get(interim)!).add(own);
        }
        // Task #1437: kund kan vara null (ingen automatisk kundkoppling) — då
        // blir nyckelrymden `${interim}\u0000` (kundlös identitet).
        const custForInterim = (r: ResolvedRow, interim: string): string | null => {
          const own = resolveOwnRowCustomerId(r);
          if (own) return own;
          const declared = declaredCustByInterim.get(interim);
          if (declared && declared.size === 1) return Array.from(declared)[0];
          return fallbackCustomerId;
        };
        const rowCustFor = (r: ResolvedRow): string | null =>
          r.fields.interim_id
            ? custForInterim(r, r.fields.interim_id)
            : resolveOwnRowCustomerId(r) ?? fallbackCustomerId;
        const interimKeyOf = (r: ResolvedRow): string | null =>
          r.fields.interim_id ? `${r.fields.interim_id}\u0000${rowCustFor(r) ?? ""}` : null;
        const parentKeyOf = (r: ResolvedRow): string | null =>
          r.fields.interim_parent_id
            ? `${r.fields.interim_parent_id}\u0000${custForInterim(r, r.fields.interim_parent_id) ?? ""}`
            : null;

        const interimIds = resolved.map((r) => r.fields.interim_id).filter(Boolean) as string[];
        const existingByInterim = new Map<string, string>(); // interimKey → objectId
        if (interimIds.length) {
          const uniqueInterims = Array.from(new Set(interimIds));
          // interim → kandidater (objekt-id + härledd kund). Kund null = objektet
          // saknar kundkoppling helt — det kan inte "tillhöra fel kund" och får
          // därför matcha vilken radkund som helst (annars skulle en saknad
          // 'Kund'-koppling tyst ge dubbletter vid varje re-import).
          const interimCandidates = new Map<string, { objektId: string; cust: string | null }[]>();
          const [interimKatalog] = await db
            .select({ id: metadataKatalog.id })
            .from(metadataKatalog)
            .where(
              and(
                eq(metadataKatalog.tenantId, tenantId),
                eq(metadataKatalog.namn, OBJEKTMALL_INTERIM_METADATA_FALT),
              ),
            );
          if (interimKatalog) {
            const metaRows = await db
              .select({ objektId: metadataVarden.objektId, varde: metadataVarden.vardeString })
              .from(metadataVarden)
              .where(
                and(
                  eq(metadataVarden.tenantId, tenantId),
                  eq(metadataVarden.status, "aktiv"),
                  eq(metadataVarden.metadataKatalogId, interimKatalog.id),
                  inArray(metadataVarden.vardeString, uniqueInterims),
                ),
              );
            const candidateIds = Array.from(
              new Set(metaRows.map((r) => r.objektId).filter(Boolean) as string[]),
            );
            const customerByObjId = await getObjectsPrimaryCustomerIds(candidateIds);
            for (const r of metaRows) {
              if (!r.varde || !r.objektId) continue;
              const arr = interimCandidates.get(r.varde) ?? [];
              arr.push({ objektId: r.objektId, cust: customerByObjId.get(r.objektId) ?? null });
              interimCandidates.set(r.varde, arr);
            }
          }
          for (const r of resolved) {
            const key = interimKeyOf(r);
            if (!key || existingByInterim.has(key)) continue;
            const rowCust = rowCustFor(r);
            const candidates = interimCandidates.get(r.fields.interim_id!) ?? [];
            // Exakt kundträff vinner; annars kund-lös kandidat. En kandidat med
            // en ANNAN känd kund matchas ALDRIG (kärnan i Task #1433).
            const hit =
              candidates.find((c) => c.cust === rowCust) ??
              candidates.find((c) => c.cust === null);
            if (hit) existingByInterim.set(key, hit.objektId);
          }
          // Bakåtkompat: MALL-<interim> i objectNumber (tenant-brett, som förr).
          // Ett legacy-objekt binds till HÖGST EN kundskopad nyckel (första
          // omatchade raden i filordning) — två kunder får aldrig samma träff.
          const mallNumbers = uniqueInterims.map((i) => OBJEKTMALL_INTERIM_PREFIX + i);
          if (mallNumbers.length) {
            const legacyByInterim = new Map<string, string>();
            const rows = await db
              .select({ id: objects.id, objectNumber: objects.objectNumber })
              .from(objects)
              .where(and(eq(objects.tenantId, tenantId), inArray(objects.objectNumber, mallNumbers)));
            for (const r of rows) {
              if (r.objectNumber?.startsWith(OBJEKTMALL_INTERIM_PREFIX)) {
                legacyByInterim.set(r.objectNumber.slice(OBJEKTMALL_INTERIM_PREFIX.length), r.id);
              }
            }
            const consumedLegacy = new Set<string>();
            for (const r of resolved) {
              const key = interimKeyOf(r);
              const interim = r.fields.interim_id;
              if (!key || !interim || existingByInterim.has(key)) continue;
              const legacyId = legacyByInterim.get(interim);
              if (legacyId && !consumedLegacy.has(legacyId)) {
                existingByInterim.set(key, legacyId);
                consumedLegacy.add(legacyId);
              }
            }
          }
        }

        const plan = buildHierarchyPlan(
          resolvedAll,
          new Set(existingByObjectNumber.keys()),
          new Set(existingByExternalId.keys()),
          new Set(existingByInterim.keys()),
          // Task #1433: kundskopad interim-identitet i gruppering + topologi.
          { groupKeyOf: interimKeyOf, parentKeyOf },
        );

        // Cykel-rader hoppas över (ska redan vara fångade i validering).
        // Skippade rader (användarval + ogiltiga) filtreras här — EFTER att
        // hierarkiplanen klassat primär/utrustning på hela filen (Task #1356).
        const cycleSet = new Set(plan.cycleRowNumbers);
        const ordered = plan.ordered.filter((p) => !cycleSet.has(p.rowNumber) && !skip.has(p.row.rowNumber));

        // §6.1: markera överhoppade rader (uttryckligt skippade, ogiltiga,
        // cykler) som "skipped" i den persistenta radmängden.
        const markRow = async (
          rowNumber: number,
          status: "imported" | "skipped" | "invalid",
          objectId: string | null,
          msg?: string,
          msgSeverity: "error" | "warning" = "error",
          // Task #1364: strukturerad orsakskod så att resultat-endpointen kan
          // klassa noteringen durabelt (utan att tolka meddelandetext).
          msgCode?: "became_root" | "equipment_skipped_missing_primary" | "kept_existing_placement",
        ) => {
          try {
            await db
              .update(objectImportRows)
              .set({
                status,
                objectId: objectId ?? null,
                ...(msg
                  ? {
                      validationMsgs: [
                        { field: "execute", message: msg, severity: msgSeverity, ...(msgCode ? { code: msgCode } : {}) },
                      ] as any,
                    }
                  : {}),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(objectImportRows.sessionId, req.params.id),
                  eq(objectImportRows.tenantId, tenantId),
                  eq(objectImportRows.rowNumber, rowNumber),
                ),
              );
          } catch {
            // Best-effort radstatus — fäll aldrig hela importen p.g.a. radmarkering.
          }
        };
        const skippedRowNumbers = Array.from(new Set([...Array.from(skip), ...plan.cycleRowNumbers]));
        if (skippedRowNumbers.length) {
          await db
            .update(objectImportRows)
            .set({ status: "skipped", updatedAt: new Date() })
            .where(
              and(
                eq(objectImportRows.sessionId, req.params.id),
                eq(objectImportRows.tenantId, tenantId),
                inArray(objectImportRows.rowNumber, skippedRowNumbers),
              ),
            );
        }

        const interimToObjectId = new Map<string, string>();
        // Parent-resolution-karta: alla kända DB-objekt per nummer (inkl. de som
        // bara refereras som föräldrar) + uppdateras under körningen.
        const objectNumberToId = new Map<string, string>(existingObjectByNumber);
        const depthByObjectId = new Map<string, number>();
        // Per-objekt resolverad kund (för att barn/utrustning ska kunna ärva
        // förälderns kund när de saknar eget kund-värde).
        const customerByObjectId = new Map<string, string>();
        let created = 0;
        let updated = 0;
        // Task #1356: rader vars förälder inte kunde resolvas.
        let becameRoots = 0; // primärrader → topphierarki (rot)
        let skippedMissingParent = 0; // utrustningsrader utan primär → hoppas över
        let errors = 0;
        const rootObjectIds = new Set<string>();
        const total = ordered.length || 1;

        // Förinläst katalog (EN SELECT för hela tenanten) → ingen per-fält-SELECT
        // under loopen. ensureKatalogRow skapar saknade katalogposter lat och
        // cachar resultatet så följande rader återanvänder samma post.
        const katalogCache = new Map<string, MetadataKatalog>();
        {
          const rows = await db
            .select()
            .from(metadataKatalog)
            .where(eq(metadataKatalog.tenantId, tenantId));
          // Task #1478: katalogen kan innehålla både en AKTIV rad och arkiverade
          // kloner med samma namn — den aktiva raden måste alltid vinna i cachen,
          // annars fastnar importvärden på en arkiverad post och döljs i alla
          // läsvägar (Objekttyp-fällan).
          for (const k of rows) {
            const prev = katalogCache.get(k.namn);
            if (!prev || (prev.deletedAt != null && k.deletedAt == null)) {
              katalogCache.set(k.namn, k);
            }
          }
        }
        const ensureKatalogRow = async (
          namn: string,
          datatyp: "string" | "json",
        ): Promise<MetadataKatalog | null> => {
          const cached = katalogCache.get(namn);
          // Aktiv cachad rad → använd direkt (cachen föredrar aktiva rader).
          if (cached && cached.deletedAt == null) return cached;
          // Task #1478: arkiverad post återställs (skriva in i en arkiverad post
          // vore ett nytt tyst tapp) och saknad post lazy-skapas. Namn-unikhet är
          // app-nivå (ingen DB-constraint), så restore/skapande serialiseras per
          // (tenant, namn) med ett transaktionsbundet advisory-lock — annars kan
          // parallella körningar lämna två aktiva rader med samma namn.
          try {
            const row = await db.transaction(async (tx) => {
              await tx.execute(
                sql`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:metadata_katalog:${namn}`}))`,
              );
              // Re-läs under låset: en parallell transaktion kan ha hunnit
              // aktivera/skapa raden innan vi fick låset.
              const existing = await tx
                .select()
                .from(metadataKatalog)
                .where(and(eq(metadataKatalog.tenantId, tenantId), eq(metadataKatalog.namn, namn)));
              const active = existing.find((k) => k.deletedAt == null);
              if (active) return active;
              const archived = existing[0];
              if (archived) {
                const [restored] = await tx
                  .update(metadataKatalog)
                  .set({ deletedAt: null, archivedBy: null, archivedReason: null })
                  .where(and(eq(metadataKatalog.id, archived.id), eq(metadataKatalog.tenantId, tenantId)))
                  .returning();
                return restored ?? null;
              }
              // Task #1441: interim-katalogposten klassas som system-/internfält
              // direkt vid lat-skapande (dold från vanliga metadatavyer, värde-
              // read-only utanför importvägen).
              const isInterim = namn === OBJEKTMALL_INTERIM_METADATA_FALT;
              const [created] = await tx
                .insert(metadataKatalog)
                .values({
                  tenantId,
                  namn,
                  datatyp,
                  kategori: "import",
                  ...(isInterim ? { isSystem: true, systemlast: true, visasIKarusell: false } : {}),
                })
                .returning();
              return created ?? null;
            });
            if (row) katalogCache.set(namn, row);
            return row;
          } catch {
            // Sista utväg: läs om utanför transaktionen — föredra AKTIV rad så
            // att en arkiverad klon aldrig cache:as framför en aktiv.
            const rows = await db
              .select()
              .from(metadataKatalog)
              .where(and(eq(metadataKatalog.tenantId, tenantId), eq(metadataKatalog.namn, namn)));
            const existing = rows.find((k) => k.deletedAt == null) ?? rows[0] ?? null;
            if (existing) katalogCache.set(namn, existing);
            return existing;
          }
        };

        // Multi-förälder: objektexporten skriver EN rad per förälderkoppling
        // (samma objektnummer på flera rader). Första raden i körningen synkar
        // primärföräldern; efterföljande rader för samma objekt läggs till som
        // sekundära kopplingar istället för att ersätta primären — annars
        // "vinner" sista raden och övriga kopplingar tappas vid round-trip.
        const parentSyncedThisRun = new Set<string>();
        const syncPrimaryParent = async (objectId: string, parentId: string | null, isNew = false) => {
          if (!parentId) return;
          if (parentSyncedThisRun.has(objectId)) {
            const dup = await db
              .select({ id: objectParents.id })
              .from(objectParents)
              .where(and(eq(objectParents.objectId, objectId), eq(objectParents.parentId, parentId), eq(objectParents.tenantId, tenantId)));
            if (!dup[0]) {
              await db.insert(objectParents).values({ tenantId, objectId, parentId, isPrimary: false, relationContext: "alternate" });
            }
            return;
          }
          parentSyncedThisRun.add(objectId);
          if (isNew) {
            // Nyskapat objekt: ingen befintlig primär-rad kan finnas → direkt insert.
            await db.insert(objectParents).values({ tenantId, objectId, parentId, isPrimary: true, relationContext: "primary" });
            return;
          }
          const existing = await db
            .select({ id: objectParents.id, parentId: objectParents.parentId })
            .from(objectParents)
            .where(and(eq(objectParents.objectId, objectId), eq(objectParents.isPrimary, true), eq(objectParents.tenantId, tenantId)));
          if (existing[0]) {
            if (existing[0].parentId !== parentId) {
              await db
                .update(objectParents)
                .set({ parentId, relationContext: "primary" })
                .where(and(eq(objectParents.id, existing[0].id), eq(objectParents.tenantId, tenantId)));
            }
            return;
          }
          await db.insert(objectParents).values({ tenantId, objectId, parentId, isPrimary: true, relationContext: "primary" });
        };

        // Etapp 5: kund-koppling skrivs som Ekonomi-metadatat 'Kund' (via
        // ensurePrimaryPayer i object-customer). En redan befintlig/ärvd kund
        // lämnas orörd — vi klampar aldrig över en existerande kundkoppling
        // vid re-import. Returnerar den NYSKAPADE metadata-radens id (annars
        // null) så Ångra kan radera exakt den raden.
        const ensurePrimaryPayer = async (
          objectId: string,
          custId: string | null,
          _isNew = false,
        ): Promise<string | null> => {
          // Task #1437: här är kunden alltid UTTRYCKLIGEN vald (body.customerId
          // eller per-rad-mappad kolumn) — märk raden med "import-explicit" så
          // städverktyg kan skilja den från legacy-fallbackens "system"-rader.
          return ensurePrimaryCustomerMetadata(tenantId, objectId, custId, "import-explicit");
        };

        const resolveParentId = (item: (typeof ordered)[number]): string | null => {
          const f = item.row.fields;
          if (item.kind === "equipment") {
            return item.interimKey ? interimToObjectId.get(item.interimKey) ?? null : null;
          }
          if (f.system_parent_id) return objectNumberToId.get(f.system_parent_id) ?? null;
          const parentKey = parentKeyOf(item.row);
          if (parentKey) return interimToObjectId.get(parentKey) ?? null;
          return null;
        };

        const buildKnownFields = (row: ResolvedRow) => {
          const addr = buildCompositeObject(row.composite.address ?? {});
          const street = [addr.street, addr.street_number].filter(Boolean).join(" ").trim();
          const out: Record<string, unknown> = {};
          const fullAddress = row.fields["address.full"] ?? street;
          if (fullAddress) out.address = fullAddress;
          if (addr.city) out.city = addr.city;
          if (addr.postal_code) out.postalCode = addr.postal_code;
          const lat = row.fields["position.lat"];
          const lng = row.fields["position.lng"];
          if (lat) out.latitude = Number(lat.replace(",", "."));
          if (lng) out.longitude = Number(lng.replace(",", "."));
          if (row.metadata.typ) out.objectType = row.metadata.typ;
          return out;
        };

        const writeRowMetadata = async (
          objektId: string,
          row: ResolvedRow,
          isNewObject: boolean,
          objectParentId: string | null,
          // Task #1433: interim-primärens interimsnummer sparas som metadata
          // ('interimsnummer') — den kundskopade matchningsnyckeln vid re-import.
          interimForMatch?: string | null,
        ) => {
          // Sammansatta metadata-punktnycklar (metadata.<grupp>.<underfält>) ska
          // grupperas till ETT json-metadatafält per grupp (tvingad json-datatyp),
          // inte skrivas en-och-en som strängar. Grupperingen är en ren helper
          // (object-import-core.groupMetadataForWrite) så den kan enhetstestas.
          //
          // Fälten samlas i prioriteringsordning (strängar → json-grupper → typ →
          // kontakt → externt_id) och skrivs i EN batch per objekt
          // (writeObjectImportMetadataBatch) istället för ett createMetadata-anrop
          // per fält. Ordningen bevaras så att första värdet vinner per katalog
          // (samma "första-skrivningen-vinner" som tidigare gav "Dubblett"-hopp).
          const { strings, jsonGroups } = groupMetadataForWrite(row.metadata);
          const fields: { namn: string; varde: string | Record<string, unknown>; datatyp: "string" | "json" }[] = [];
          for (const s of strings) fields.push({ namn: s.namn, varde: s.varde, datatyp: "string" });
          for (const g of jsonGroups) fields.push({ namn: g.namn, varde: g.varde, datatyp: "json" });
          // Task #1484: klassificering skrivs till det KANONISKA katalogfältet
          // "Objekttyp" (systemområdet Klassificering) — inte ett eget "typ"-fält.
          // objects.objectType sätts fortfarande av buildKnownFields = avsiktlig
          // kolumn-cache under expand-fasen.
          if (row.metadata.typ) fields.push({ namn: "Objekttyp", varde: row.metadata.typ, datatyp: "string" });
          const contact = buildCompositeObject(row.composite.contact ?? {});
          if (Object.keys(contact).length) fields.push({ namn: "kontaktperson", varde: contact, datatyp: "json" });
          if (row.fields.external_id) fields.push({ namn: "externt_id", varde: row.fields.external_id, datatyp: "string" });
          if (interimForMatch)
            fields.push({ namn: OBJEKTMALL_INTERIM_METADATA_FALT, varde: interimForMatch, datatyp: "string" });
          if (fields.length === 0) return;

          const katalogByName = new Map<string, MetadataKatalog>();
          for (const f of fields) {
            const k = await ensureKatalogRow(f.namn, f.datatyp);
            if (k) katalogByName.set(f.namn, k);
          }
          await writeObjectImportMetadataBatch({
            tenantId,
            objektId,
            objectParentId,
            isNewObject,
            fields,
            katalogByName,
            skapadAv: userId ?? undefined,
            overwriteExisting: overwriteMetadata,
          });
        };

        // Ångra-funktion: snapshot av metadata_varden-id:n för ett objekt (för
        // att diffa vilka rader en uppdatering skapade → metadata_write-undo).
        const metadataIdsFor = async (objektId: string): Promise<Set<string>> => {
          const rows = await db
            .select({ id: metadataVarden.id })
            .from(metadataVarden)
            .where(and(eq(metadataVarden.objektId, objektId), eq(metadataVarden.tenantId, tenantId)));
          return new Set(rows.map((r) => r.id));
        };

        // Ångra-funktion: persistera batch + åtgärder INKREMENTELLT (per rad), inte
        // i en klump efter loopen — så ett avbrott mitt i en stor import ändå lämnar
        // de redan utförda raderna ångringsbara. Batch-raden skapas lat vid första
        // åtgärden (tomma batchar undviks) och dess räknare uppdateras efter loopen.
        let batchPersisted = false;
        const stampAction = async (action: Record<string, unknown>): Promise<string> => {
          if (!batchPersisted) {
            await db.insert(importBatches).values({
              tenantId,
              batchId,
              sessionId: req.params.id,
              totalRows: resolved.length,
              created: 0,
              updated: 0,
              errors: 0,
              sourceFlow: "objects-v2",
              undoExpiresAt: new Date(Date.now() + IMPORT_UNDO_WINDOW_MS),
              metadata: { importV2: true } as any,
            } as any);
            batchPersisted = true;
          }
          const [ins] = await db
            .insert(importActions)
            .values(action as any)
            .returning({ id: importActions.id });
          return ins.id;
        };

        let processed = 0;
        for (const item of ordered) {
          try {
            const row = item.row;
            const parentId = resolveParentId(item);
            const known = buildKnownFields(row);
            // Aktivstatus-import: "arkiverad" ⇒ arkivera (soft-delete),
            // "aktiv" ⇒ återställ. null = ingen aktivstatus-kolumn / okänt värde
            // ⇒ ingen livscykel-åtgärd (objektets nuvarande tillstånd bevaras).
            const activeStatus = parseActiveStatus(row.fields.active_status);

            // Resolvera radens kund: eget värde → förälderns kund → uttryckligen
            // vald standardkund (annars null = ingen kundkoppling, Task #1437).
            const rowCustomerId: string | null =
              resolveOwnRowCustomerId(row) ??
              (parentId ? customerByObjectId.get(parentId) : undefined) ??
              fallbackCustomerId;

            // Task #1356: en rad som UTTRYCKLIGEN pekar ut en förälder som inte
            // kan resolvas importeras som topphierarki (rot) — men aldrig TYST:
            // varningen stämplas på raden (validationMsgs) och antalet
            // redovisas i resultatet (became_roots). Utrustningsrader (delar
            // interim med en primärrad) kan inte bli rötter — utan sin primär
            // hoppas de över, annars skulle utrustning sväva fritt i trädet.
            const declaresParent =
              item.kind === "equipment"
                ? !!item.interimId
                : !!(row.fields.system_parent_id || row.fields.interim_parent_id);
            let unresolvedParent = false;
            if (declaresParent && !parentId) {
              if (item.kind === "equipment") {
                await markRow(
                  row.rowNumber,
                  "skipped",
                  null,
                  `Primärraden för interim "${item.interimId ?? ""}" importerades inte — utrustningsraden hoppas över.`,
                  "warning",
                  "equipment_skipped_missing_primary",
                );
                skippedMissingParent++;
                continue;
              }
              unresolvedParent = true;
            }
            const unresolvedParentRef = `(system_parent_id="${row.fields.system_parent_id ?? ""}", interim_parent_id="${row.fields.interim_parent_id ?? ""}")`;

            // Bestäm mål-objekt-id för uppdatering (Systemnummer > externt_id >
            // Interimsnummer).
            // Task #1433: interim-primärens interimsnummer sparas som metadata
            // ('interimsnummer') på både nyskapade och uppdaterade objekt —
            // uppdateringar migrerar då befintliga MALL-objekt framåt till den
            // nya kundskopade matchningsnyckeln (expand-contract).
            const rowInterim =
              item.kind === "primary" && item.interimId && !row.fields.system_id
                ? item.interimId
                : null;

            let targetId: string | null = null;
            if (item.action === "update") {
              if (row.fields.system_id) targetId = existingByObjectNumber.get(row.fields.system_id) ?? null;
              if (!targetId && row.fields.external_id) targetId = existingByExternalId.get(row.fields.external_id) ?? null;
              // Equipment får ALDRIG matchas via det delade interim_id:t (skulle
              // träffa butiks-objektet) — bara primärer.
              if (!targetId && item.kind !== "equipment" && item.interimKey)
                targetId = existingByInterim.get(item.interimKey) ?? null;
            }

            if (targetId) {
              // Tenant-scopad UPDATE (defense-in-depth: tenant_id i WHERE även
              // om targetId redan härleddes från tenant-scopade uppslag).
              const updateData: Record<string, unknown> = { ...(known as any) };
              if (row.fields.name) updateData.name = row.fields.name;
              if (parentId) updateData.parentId = parentId;
              // Task #1357: stämpla även uppdaterade objekt med batch-id:t så att
              // "Visa objekten" (importBatch-filtret) visar HELA importens resultat,
              // inte bara nyskapade rader. Vid re-import vinner senaste batchen.
              updateData.importBatchId = batchId;
              // Ångra-funktion: snapshot:a objektets tillstånd FÖRE uppdateringen
              // (before) — undo återställer endast om nuvarande state == after.
              const [preSnapshot] = await db
                .select(objectSnapshotColumns)
                .from(objects)
                .where(and(eq(objects.id, targetId), eq(objects.tenantId, tenantId)));
              const metaIdsBefore = await metadataIdsFor(targetId);
              // Aktivstatus-livscykel: arkivera/återställ som DEL av samma UPDATE
              // (atomiskt med skalär-ändringarna). Arkiv-fälten hämtas separat —
              // objectSnapshotColumns är de 8 skalär-fälten (oförändrat snapshot-
              // format för vanliga uppdateringar). Vid arkivering av ett AKTIVT
              // objekt körs preflight FÖRST: hård-blockare (aktiva underobjekt)
              // kastar per-rad (ingen tyst kaskad). Idempotent: redan arkiverad +
              // "arkiverad" = no-op; redan aktiv + "aktiv" = no-op.
              type LifecycleState = {
                deletedAt: Date | null;
                archivedBy: string | null;
                archivedReason: string | null;
              };
              let lifecycleBefore: LifecycleState | null = null;
              let lifecycleAfter: LifecycleState | null = null;
              if (activeStatus) {
                const [lc] = await db
                  .select({
                    deletedAt: objects.deletedAt,
                    archivedBy: objects.archivedBy,
                    archivedReason: objects.archivedReason,
                  })
                  .from(objects)
                  .where(and(eq(objects.id, targetId), eq(objects.tenantId, tenantId)));
                lifecycleBefore = {
                  deletedAt: lc?.deletedAt ?? null,
                  archivedBy: lc?.archivedBy ?? null,
                  archivedReason: lc?.archivedReason ?? null,
                };
                const currentlyArchived = lifecycleBefore.deletedAt != null;
                if (activeStatus === "archived" && !currentlyArchived) {
                  const pre = await archivePreflight(targetId, tenantId);
                  const hardBlockers = pre.blockers.filter((b) => !/redan arkiverat/i.test(b));
                  if (hardBlockers.length > 0) {
                    throw new Error(`Kan inte arkivera objektet: ${hardBlockers.join("; ")}`);
                  }
                  updateData.deletedAt = new Date();
                  updateData.archivedBy = userId ?? null;
                  updateData.archivedReason = "Import: aktivstatus=arkiverad";
                } else if (activeStatus === "active" && currentlyArchived) {
                  updateData.deletedAt = null;
                  updateData.archivedBy = null;
                  updateData.archivedReason = null;
                }
                lifecycleAfter = {
                  deletedAt: (Object.prototype.hasOwnProperty.call(updateData, "deletedAt")
                    ? updateData.deletedAt
                    : lifecycleBefore.deletedAt) as Date | null,
                  archivedBy: (Object.prototype.hasOwnProperty.call(updateData, "archivedBy")
                    ? updateData.archivedBy
                    : lifecycleBefore.archivedBy) as string | null,
                  archivedReason: (Object.prototype.hasOwnProperty.call(updateData, "archivedReason")
                    ? updateData.archivedReason
                    : lifecycleBefore.archivedReason) as string | null,
                };
              }
              // RETURNING ger objektets effektiva förälder efter uppdateringen
              // (= nysatt parentId, annars bevarad DB-förälder). Den används som
              // nivå-lås-frö i metadata-batchen så låskontrollen bevaras exakt
              // även för uppdaterings-rader som inte deklarerar någon förälder.
              const [updatedRow] = await db
                .update(objects)
                .set(updateData as any)
                .where(and(eq(objects.id, targetId), eq(objects.tenantId, tenantId)))
                .returning({ parentId: objects.parentId });
              const effectiveParentId = updatedRow?.parentId ?? parentId ?? null;
              // Task #1484: importens direkta kolumn-UPDATE går förbi storage.updateObject —
              // spegla explicit satt objekttyp till metadata (auto-rad, manuell rad vinner).
              if ((updateData as any).objectType || (updateData as any).hierarchyLevel) {
                try {
                  const { mirrorClassificationToMetadata } = await import("../services/object-classification");
                  await mirrorClassificationToMetadata(tenantId, targetId, {
                    objectType: (updateData as any).objectType ?? null,
                    hierarchyLevel: (updateData as any).hierarchyLevel ?? null,
                  });
                } catch (err) {
                  console.error(`[objects-v2] classification mirror failed object=${targetId}:`, err);
                }
              }
              // Ångra-funktion: stämpla update_object DIREKT efter scalar-UPDATE:n och
              // FÖRE de sekundära best-effort-stegen (parent/payer/metadata). Då blir
              // skalär-ändringen alltid ångringsbar även om ett senare steg kastar
              // (raden markeras då invalid men mutationen är ändå registrerad).
              if (preSnapshot) {
                const k = known as any;
                const afterSnapshot: ObjectSnapshot = {
                  name: row.fields.name || preSnapshot.name,
                  parentId: effectiveParentId,
                  address: k.address ?? preSnapshot.address,
                  city: k.city ?? preSnapshot.city,
                  postalCode: k.postalCode ?? preSnapshot.postalCode,
                  latitude: k.latitude ?? preSnapshot.latitude,
                  longitude: k.longitude ?? preSnapshot.longitude,
                  objectType: k.objectType ?? preSnapshot.objectType,
                };
                // Aktivstatus-rader: stämpla med arkiv-fälten i BÅDA snapshots så
                // undo blir livscykel-aware (jämför + återställer arkiv-tillstånd).
                // Vanliga rader stämplas exakt som förr (legacy, 8 fält) — då rör
                // undo aldrig arkiv-fälten.
                const beforeJson: any =
                  activeStatus && lifecycleBefore
                    ? {
                        ...preSnapshot,
                        deletedAt: lifecycleBefore.deletedAt,
                        archivedBy: lifecycleBefore.archivedBy,
                        archivedReason: lifecycleBefore.archivedReason,
                      }
                    : preSnapshot;
                const afterJson: any =
                  activeStatus && lifecycleAfter
                    ? {
                        ...afterSnapshot,
                        deletedAt: lifecycleAfter.deletedAt,
                        archivedBy: lifecycleAfter.archivedBy,
                        archivedReason: lifecycleAfter.archivedReason,
                      }
                    : afterSnapshot;
                await stampAction({
                  tenantId,
                  batchId,
                  sessionId: req.params.id,
                  sourceFlow: "objects-v2",
                  rowNumber: item.row.rowNumber ?? null,
                  actionType: "update_object",
                  entityType: "object",
                  entityId: targetId,
                  beforeJson,
                  afterJson,
                  status: "applied",
                });
              }
              await syncPrimaryParent(targetId, parentId);
              await ensurePrimaryPayer(targetId, rowCustomerId);
              // Ångra-funktion (atomicitet): vi kan INTE göra metadata-skrivningen och
              // dess undo-stämpel atomiska i en db.transaction — writeObjectImportMetadataBatch
              // har best-effort per-rad-fallback (ett constraint-fel → row-by-row retry),
              // vilket en omslutande PG-transaktion skulle bryta (avbruten tx avvisar alla
              // följande satser). Istället PRE-stämplar vi metadata_write FÖRE skrivningen
              // med en baslinje (befintliga metadata-id:n) och afterJson.ids=null (= ej
              // finaliserad). Då kan ingen lyckad metadata-skrivning slutföras utan en
              // åtgärds-rad. Efter skrivningen FINALISERAR vi ids exakt via en diff. Om
              // processen kraschar i fönstret mellan skrivning och finalisering återställer
              // undo via baslinjen (radera objektets nuvarande metadata som inte fanns vid
              // importtillfället). writeObjectImportMetadataBatch lämnas helt orörd.
              const metaActionId = await stampAction({
                tenantId,
                batchId,
                sessionId: req.params.id,
                sourceFlow: "objects-v2",
                rowNumber: item.row.rowNumber ?? null,
                actionType: "metadata_write",
                entityType: "metadata_varden",
                entityId: targetId,
                beforeJson: { baseline: Array.from(metaIdsBefore) } as any,
                afterJson: { ids: null } as any,
                status: "applied",
              });
              await writeRowMetadata(targetId, row, false, effectiveParentId, rowInterim);
              const metaIdsAfter = await metadataIdsFor(targetId);
              const newMetaIds = Array.from(metaIdsAfter).filter((x) => !metaIdsBefore.has(x));
              await db
                .update(importActions)
                .set({ afterJson: { ids: newMetaIds } as any })
                .where(and(eq(importActions.id, metaActionId), eq(importActions.tenantId, tenantId)));
              if (rowCustomerId) customerByObjectId.set(targetId, rowCustomerId);
              if (item.interimKey && item.kind === "primary") interimToObjectId.set(item.interimKey, targetId);
              if (row.fields.system_id) objectNumberToId.set(row.fields.system_id, targetId);
              depthByObjectId.set(targetId, parentId ? (depthByObjectId.get(parentId) ?? 0) + 1 : 0);
              if (!parentId) rootObjectIds.add(targetId);
              updated++;
              // Uppdaterings-rader ROT-IFIERAS ALDRIG: en ej-resolverbar förälder
              // får inte koppla loss ett befintligt objekt från sin nuvarande
              // placering (destruktivt). Behåll placeringen och redovisa ärligt.
              await markRow(
                item.row.rowNumber,
                "imported",
                targetId,
                unresolvedParent
                  ? `Föräldern kunde inte hittas ${unresolvedParentRef} — objektets befintliga placering behålls.`
                  : undefined,
                "warning",
                unresolvedParent ? "kept_existing_placement" : undefined,
              );
            } else {
              // Task #1433: interim-primärer får ett SYSTEMMYNTAT löpnummer
              // (OBJ-NNN via createObject, objectNumber utelämnas) i stället för
              // MALL-<interim>. Interimsnumret sparas separat som metadata
              // (rowInterim → writeRowMetadata) och används som kundskopad
              // matchningsnyckel vid re-import.
              // Objektnamn är inte hårt obligatoriskt: saknas namn får objektet
              // sitt nummer som namn (uppdateras manuellt efteråt).
              const fallbackName =
                row.fields.name ||
                row.fields.system_id ||
                item.interimId ||
                "Namnlöst objekt";
              const createdObj = await storage.createObject({
                tenantId,
                // Etapp 5: kundkopplingen skrivs som Ekonomi-metadata ('Kund')
                // via ensurePrimaryPayer direkt efter create nedan.
                parentId: parentId ?? null,
                name: fallbackName,
                // Ångra-funktion: koppla objektet till batchen för spårbarhet.
                importBatchId: batchId,
                ...(known as any),
              } as any);
              await syncPrimaryParent(createdObj.id, parentId, true);
              const createdPayerId = await ensurePrimaryPayer(createdObj.id, rowCustomerId, true);
              // Ångra-funktion: stämpla create_object DIREKT efter att objektet + payer
              // skapats och FÖRE writeRowMetadata (det mest fel-benägna steget). Då är
              // objektet alltid ångringsbart (undo soft-deletear det och metadata göms
              // automatiskt med objektet) även om metadata-skrivningen kastar.
              {
                const k = known as any;
                const afterSnapshot: ObjectSnapshot = {
                  name: fallbackName,
                  parentId: parentId ?? null,
                  address: k.address ?? null,
                  city: k.city ?? null,
                  postalCode: k.postalCode ?? null,
                  latitude: k.latitude ?? null,
                  longitude: k.longitude ?? null,
                  objectType: k.objectType ?? "omrade",
                };
                await stampAction({
                  tenantId,
                  batchId,
                  sessionId: req.params.id,
                  sourceFlow: "objects-v2",
                  rowNumber: item.row.rowNumber ?? null,
                  actionType: "create_object",
                  entityType: "object",
                  entityId: createdObj.id,
                  beforeJson: null,
                  // payerIds = den payer-rad importen skapade (för selektiv undo).
                  afterJson: { ...afterSnapshot, payerIds: createdPayerId ? [createdPayerId] : [] } as any,
                  status: "applied",
                });
              }
              // Aktivstatus=arkiverad på en NY rad: skapa objektet aktivt (ovan) och
              // arkivera det direkt (soft-delete). Ingen preflight behövs — ett nyss
              // skapat objekt har inga aktiva underobjekt/ordrar. create_object-undo
              // soft-deletear redan objektet, så åter-arkiveringen är idempotent och
              // kräver ingen extra undo-stämpel. ("aktiv" = standard, ingen åtgärd.)
              if (activeStatus === "archived") {
                await db
                  .update(objects)
                  .set({
                    deletedAt: new Date(),
                    archivedBy: userId ?? null,
                    archivedReason: "Import: aktivstatus=arkiverad",
                  })
                  .where(and(eq(objects.id, createdObj.id), eq(objects.tenantId, tenantId)));
              }
              await writeRowMetadata(createdObj.id, row, true, parentId, rowInterim);
              if (rowCustomerId) customerByObjectId.set(createdObj.id, rowCustomerId);
              if (item.interimKey && item.kind === "primary") interimToObjectId.set(item.interimKey, createdObj.id);
              depthByObjectId.set(createdObj.id, parentId ? (depthByObjectId.get(parentId) ?? 0) + 1 : 0);
              if (!parentId) rootObjectIds.add(createdObj.id);
              created++;
              if (unresolvedParent) becameRoots++;
              await markRow(
                item.row.rowNumber,
                "imported",
                createdObj.id,
                unresolvedParent
                  ? `Föräldern kunde inte hittas ${unresolvedParentRef} — objektet importerades som topphierarki (rot).`
                  : undefined,
                "warning",
                unresolvedParent ? "became_root" : undefined,
              );
            }
          } catch (err: any) {
            errors++;
            await markRow(item.row.rowNumber, "invalid", null, String(err?.message ?? err));
          } finally {
            processed++;
            if (processed % 25 === 0 || processed === ordered.length) {
              const progress = Math.round((processed / total) * 100);
              await db
                .update(objectImportSessions)
                .set({ progress, updatedAt: new Date() })
                .where(and(eq(objectImportSessions.id, req.params.id), eq(objectImportSessions.tenantId, tenantId)));
            }
          }
        }

        // Ångra-funktion: uppdatera batch-räknarna med slutgiltiga summor (raderna
        // stämplades redan inkrementellt via stampAction under loopen, så batchen är
        // ångringsbar även om importen avbröts mitt i).
        if (batchPersisted) {
          await db
            .update(importBatches)
            .set({ created, updated, errors })
            .where(and(eq(importBatches.batchId, batchId), eq(importBatches.tenantId, tenantId)));
        }

        const totalLevels = depthByObjectId.size ? Math.max(...Array.from(depthByObjectId.values())) + 1 : 0;
        const result = {
          status: "completed",
          summary: {
            total_rows: resolved.length,
            created,
            updated,
            skipped: rawRows.length - resolved.length + skippedMissingParent,
            errors,
            // Task #1356: rader med ej-resolverbar förälder.
            became_roots: becameRoots,
            skipped_missing_parent: skippedMissingParent,
          },
          hierarchy: {
            root_objects: rootObjectIds.size,
            total_levels: totalLevels,
            total_objects: created + updated,
          },
          customer_id: fallbackCustomerId,
          // Task #1357: låt klienten länka till objektlistan filtrerad på batchen.
          import_batch_id: batchId,
          customers_linked: new Set(Array.from(customerByObjectId.values())).size,
          per_row_customer: perRowCustomer,
        };

        await db
          .update(objectImportSessions)
          .set({ status: "completed", progress: 100, result: result as any, updatedAt: new Date() })
          .where(and(eq(objectImportSessions.id, req.params.id), eq(objectImportSessions.tenantId, tenantId)));
      } catch (err: any) {
        await db
          .update(objectImportSessions)
          .set({ status: "failed", error: String(err?.message ?? err), updatedAt: new Date() })
          .where(and(eq(objectImportSessions.id, req.params.id), eq(objectImportSessions.tenantId, tenantId)));
      }
      };

      void runImport();
      res.status(202).json({ session_id: session.id, status: "importing" });
    }),
  );
}
