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
  metadataKatalog,
  metadataVarden,
  objectImportRows,
  objectImportSessions,
  objectParents,
  objectPayers,
  objects,
  type MetadataKatalog,
} from "@shared/schema";
import { storage } from "../storage";
import { ensureClusterForCustomer } from "../auto-cluster";
import { writeObjectImportMetadataBatch } from "../metadata-queries";
import {
  buildColumns,
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
} from "@shared/object-import-spec";
import { OBJEKTMALL_INTERIM_PREFIX } from "@shared/objektmall-template";

function getUserId(req: Request): string | null {
  return (req as any).user?.claims?.sub ?? (req as any).user?.id ?? null;
}

type DetectedColumn = ReturnType<typeof buildColumns>[number];
type RawRow = Record<string, string>;

// Bygg en auto-mappning från detekterade kolumner.
function autoMappings(columns: DetectedColumn[]): ColumnMappings {
  const mappings: ColumnMappings = {};
  for (const col of columns) {
    if (col.autoMatch && col.autoMatch !== "__empty") {
      mappings[String(col.index)] = {
        target: col.autoMatch,
        type: categoryForTarget(col.autoMatch),
        required: col.autoMatch === "name",
      };
    }
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
});

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

      // Tenant-definierade metadatafält → metadata.<namn>.
      const katalog = await db
        .select({ namn: metadataKatalog.namn, beskrivning: metadataKatalog.beskrivning })
        .from(metadataKatalog)
        .where(eq(metadataKatalog.tenantId, tenantId));
      const metadataFields: FieldDefinition[] = katalog.map((k) => ({
        key: `metadata.${k.namn}`,
        label: `metadata.${k.namn}`,
        description: k.beskrivning ?? "Kunddefinierat metadatafält",
        category: "metadata",
        type: "text",
        required: false,
      }));

      let all = [...FIELD_CATALOG, ...metadataFields];
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
      const columns = buildColumns(systemHeaders, userHeaders);

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
        .set({ mappings: parsed.data.mappings as any, status: "mapping", updatedAt: new Date() })
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
          row.issues.push({
            field: "system_parent_id",
            message: `Systemföräldranummer "${sp}" finns inte i Traivo`,
            severity: "error",
          });
          row.status = "invalid";
        }
      }

      // §5.3 Kund-referenskontroll (varning, ej blockerande): om en kund-kolumn
      // är mappad och ett rad-värde inte matchar någon kund i Traivo faller raden
      // tillbaka på standardkunden vid execute. Varna så användaren ser det innan
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
            message: `Kund "${label}" hittades inte — raden hamnar under standardkunden`,
            severity: "warning",
          });
          if (row.status === "valid") row.status = "warning";
        }
      }

      const rows = Array.from(byRow.values());
      const summary = {
        total_rows: rows.length,
        valid: rows.filter((r) => r.status === "valid").length,
        warning: rows.filter((r) => r.status === "warning").length,
        invalid: rows.filter((r) => r.status === "invalid").length,
      };
      const validation = { summary, rows };

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
      res.json(session.result ?? null);
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

      // Standardkund (fallback) att hänga objekten på (objects.customer_id NOT
      // NULL). Använd vald kund (tenant-verifierad) annars första aktiva kund.
      // ADR v3: objekt är neutrala — verklig koppling sker via object_payers, så
      // varje skapat objekt får dessutom en primär object_payer på resolverad
      // kund (per-rad om en kund-kolumn är mappad, annars denna fallback).
      let customerId = parsed.data.customerId ?? null;
      if (customerId) {
        const ownCheck = await db.execute(
          sql`SELECT id FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId} AND deleted_at IS NULL LIMIT 1`,
        );
        const ok = (ownCheck as any).rows?.[0] ?? (Array.isArray(ownCheck) ? (ownCheck as any)[0] : null);
        if (!ok) throw new ValidationError("Vald kund tillhör inte denna tenant.");
      } else {
        const rows = await db.execute(
          sql`SELECT id FROM customers WHERE tenant_id = ${tenantId} AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
        );
        const first = (rows as any).rows?.[0] ?? (Array.isArray(rows) ? (rows as any)[0] : null);
        if (!first?.id) throw new ValidationError("Tenant saknar kunder — skapa minst en kund innan import.");
        customerId = first.id as string;
      }
      const fallbackCustomerId = customerId;

      // Per-rad kundmappning: om en kolumn mappats till customer_name/customer_ref
      // resolvas kunden per rad mot tenantens kunder (namn / kundnummer / org.nr).
      // Oresolverbara värden faller tillbaka på standardkunden ovan.
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
      // förälderns kund (utrustning/barn) eller falla tillbaka på standardkunden.
      const resolveOwnRowCustomerId = (row: ResolvedRow): string | null => {
        if (!perRowCustomer) return null;
        const ref = (row.fields.customer_ref ?? "").trim().toLowerCase();
        if (ref && customerByRef.has(ref)) return customerByRef.get(ref)!;
        const name = (row.fields.customer_name ?? "").trim().toLowerCase();
        if (name && customerByName.has(name)) return customerByName.get(name)!;
        return null;
      };

      // Klustret beror på kunden — cacha per kund så fler kunder i samma fil får
      // var sitt kluster utan att ensureClusterForCustomer körs en gång per rad.
      const clusterByCustomer = new Map<string, string>();
      const ensureCluster = async (custId: string): Promise<string> => {
        const cached = clusterByCustomer.get(custId);
        if (cached) return cached;
        const cid = await ensureClusterForCustomer(tenantId, custId);
        clusterByCustomer.set(custId, cid);
        return cid;
      };
      const clusterId = await ensureCluster(fallbackCustomerId);

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
        const resolved: ResolvedRow[] = rawRows
          .map((raw, i) => resolveRow(i + 1, raw, mappings))
          .filter((r) => !skip.has(r.rowNumber));

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
                  eq(metadataVarden.metadataKatalogId, extKatalog.id),
                  inArray(metadataVarden.vardeString, externalIds),
                ),
              );
            for (const r of rows) if (r.varde && r.objektId) existingByExternalId.set(r.varde, r.objektId);
          }
        }

        // Befintliga objekt via interimsnummer (3:e prioritet) — interim-skapade
        // objekt lagras med objectNumber MALL-<interim> (v1-konvention), så
        // re-import av samma interim uppdaterar istället för att duplicera.
        const interimIds = resolved.map((r) => r.fields.interim_id).filter(Boolean) as string[];
        const existingByInterim = new Map<string, string>(); // interim_id → objectId
        if (interimIds.length) {
          const mallNumbers = Array.from(new Set(interimIds)).map((i) => OBJEKTMALL_INTERIM_PREFIX + i);
          const rows = await db
            .select({ id: objects.id, objectNumber: objects.objectNumber })
            .from(objects)
            .where(and(eq(objects.tenantId, tenantId), inArray(objects.objectNumber, mallNumbers)));
          for (const r of rows) {
            if (r.objectNumber?.startsWith(OBJEKTMALL_INTERIM_PREFIX)) {
              existingByInterim.set(r.objectNumber.slice(OBJEKTMALL_INTERIM_PREFIX.length), r.id);
            }
          }
        }

        const plan = buildHierarchyPlan(
          resolved,
          new Set(existingByObjectNumber.keys()),
          new Set(existingByExternalId.keys()),
          new Set(existingByInterim.keys()),
        );

        // Cykel-rader hoppas över (ska redan vara fångade i validering).
        const cycleSet = new Set(plan.cycleRowNumbers);
        const ordered = plan.ordered.filter((p) => !cycleSet.has(p.rowNumber));

        // §6.1: markera överhoppade rader (uttryckligt skippade, ogiltiga,
        // cykler) som "skipped" i den persistenta radmängden.
        const markRow = async (
          rowNumber: number,
          status: "imported" | "skipped" | "invalid",
          objectId: string | null,
          msg?: string,
        ) => {
          try {
            await db
              .update(objectImportRows)
              .set({
                status,
                objectId: objectId ?? null,
                ...(msg
                  ? { validationMsgs: [{ field: "execute", message: msg, severity: "error" }] as any }
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
          for (const k of rows) katalogCache.set(k.namn, k);
        }
        const ensureKatalogRow = async (
          namn: string,
          datatyp: "string" | "json",
        ): Promise<MetadataKatalog | null> => {
          const cached = katalogCache.get(namn);
          if (cached) return cached;
          try {
            const [created] = await db
              .insert(metadataKatalog)
              .values({ tenantId, namn, datatyp, kategori: "import" })
              .returning();
            if (created) katalogCache.set(namn, created);
            return created ?? null;
          } catch {
            // Race: en parallell skrivning hann skapa katalogen — läs om.
            const [existing] = await db
              .select()
              .from(metadataKatalog)
              .where(and(eq(metadataKatalog.tenantId, tenantId), eq(metadataKatalog.namn, namn)));
            if (existing) katalogCache.set(namn, existing);
            return existing ?? null;
          }
        };

        const syncPrimaryParent = async (objectId: string, parentId: string | null, isNew = false) => {
          if (!parentId) return;
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

        // ADR v3: verklig kund-koppling sker via object_payers (objects.customer_id
        // är under avveckling). Säkerställ en primär betalare på resolverad kund.
        // En redan befintlig primär payer (manuellt satt / annan kund) lämnas
        // orörd — vi klampar aldrig över en existerande kundkoppling vid re-import.
        const ensurePrimaryPayer = async (objectId: string, custId: string, isNew = false) => {
          if (!isNew) {
            const existing = await db
              .select({ id: objectPayers.id })
              .from(objectPayers)
              .where(
                and(
                  eq(objectPayers.objectId, objectId),
                  eq(objectPayers.isPrimary, true),
                  eq(objectPayers.tenantId, tenantId),
                ),
              );
            if (existing[0]) return;
          }
          try {
            await db.insert(objectPayers).values({
              tenantId,
              objectId,
              customerId: custId,
              payerType: "primary",
              isPrimary: true,
              sharePercent: 100,
              priority: 1,
            });
          } catch {
            // Best-effort kund-koppling — fäll aldrig hela importen p.g.a. payer.
          }
        };

        const resolveParentId = (item: (typeof ordered)[number]): string | null => {
          const f = item.row.fields;
          if (item.kind === "equipment") {
            return item.interimId ? interimToObjectId.get(item.interimId) ?? null : null;
          }
          if (f.system_parent_id) return objectNumberToId.get(f.system_parent_id) ?? null;
          if (f.interim_parent_id) return interimToObjectId.get(f.interim_parent_id) ?? null;
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
          if (row.metadata.typ) fields.push({ namn: "typ", varde: row.metadata.typ, datatyp: "string" });
          const contact = buildCompositeObject(row.composite.contact ?? {});
          if (Object.keys(contact).length) fields.push({ namn: "kontaktperson", varde: contact, datatyp: "json" });
          if (row.fields.external_id) fields.push({ namn: "externt_id", varde: row.fields.external_id, datatyp: "string" });
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
          });
        };

        let processed = 0;
        for (const item of ordered) {
          try {
            const row = item.row;
            const parentId = resolveParentId(item);
            const known = buildKnownFields(row);

            // Resolvera radens kund: eget värde → förälderns kund → standardkund.
            const rowCustomerId =
              resolveOwnRowCustomerId(row) ??
              (parentId ? customerByObjectId.get(parentId) : undefined) ??
              fallbackCustomerId;
            const rowClusterId = await ensureCluster(rowCustomerId);

            // Fail-closed (defense-in-depth): execute kan köras utan föregående
            // validate (endast mappningar krävs). Om en rad UTTRYCKLIGEN pekar ut
            // en förälder men den inte kan resolvas får raden ALDRIG tyst
            // importeras som rot — då skulle ett påhittat system_parent_id
            // korrumpera hierarkin trots att validate-fixen stänger validate-vägen.
            const declaresParent =
              item.kind === "equipment"
                ? !!item.interimId
                : !!(row.fields.system_parent_id || row.fields.interim_parent_id);
            if (declaresParent && !parentId) {
              throw new Error(
                `Föräldern kunde inte hittas (system_parent_id="${row.fields.system_parent_id ?? ""}", interim_parent_id="${row.fields.interim_parent_id ?? ""}") — raden importeras inte som rotobjekt.`,
              );
            }

            // Bestäm mål-objekt-id för uppdatering (Systemnummer > externt_id >
            // Interimsnummer).
            let targetId: string | null = null;
            if (item.action === "update") {
              if (row.fields.system_id) targetId = existingByObjectNumber.get(row.fields.system_id) ?? null;
              if (!targetId && row.fields.external_id) targetId = existingByExternalId.get(row.fields.external_id) ?? null;
              // Equipment får ALDRIG matchas via det delade interim_id:t (skulle
              // träffa butiks-objektet) — bara primärer.
              if (!targetId && item.kind !== "equipment" && row.fields.interim_id)
                targetId = existingByInterim.get(row.fields.interim_id) ?? null;
            }

            if (targetId) {
              // Tenant-scopad UPDATE (defense-in-depth: tenant_id i WHERE även
              // om targetId redan härleddes från tenant-scopade uppslag).
              const updateData: Record<string, unknown> = { ...(known as any) };
              if (row.fields.name) updateData.name = row.fields.name;
              if (parentId) updateData.parentId = parentId;
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
              await syncPrimaryParent(targetId, parentId);
              await ensurePrimaryPayer(targetId, rowCustomerId);
              await writeRowMetadata(targetId, row, false, effectiveParentId);
              customerByObjectId.set(targetId, rowCustomerId);
              if (item.interimId && item.kind === "primary") interimToObjectId.set(item.interimId, targetId);
              if (row.fields.system_id) objectNumberToId.set(row.fields.system_id, targetId);
              depthByObjectId.set(targetId, parentId ? (depthByObjectId.get(parentId) ?? 0) + 1 : 0);
              if (!parentId) rootObjectIds.add(targetId);
              updated++;
              await markRow(item.row.rowNumber, "imported", targetId);
            } else {
              // Interim-primärer utan systemnummer får objectNumber MALL-<interim>
              // så re-import matchar dem (uppdaterar istället för dubblerar).
              const interimObjectNumber =
                item.kind === "primary" && item.interimId && !row.fields.system_id
                  ? OBJEKTMALL_INTERIM_PREFIX + item.interimId
                  : undefined;
              const createdObj = await storage.createObject({
                tenantId,
                customerId: rowCustomerId,
                clusterId: rowClusterId,
                parentId: parentId ?? null,
                name: row.fields.name || "Namnlöst objekt",
                ...(interimObjectNumber ? { objectNumber: interimObjectNumber } : {}),
                ...(known as any),
              } as any);
              await syncPrimaryParent(createdObj.id, parentId, true);
              await ensurePrimaryPayer(createdObj.id, rowCustomerId, true);
              await writeRowMetadata(createdObj.id, row, true, parentId);
              customerByObjectId.set(createdObj.id, rowCustomerId);
              if (item.interimId && item.kind === "primary") interimToObjectId.set(item.interimId, createdObj.id);
              depthByObjectId.set(createdObj.id, parentId ? (depthByObjectId.get(parentId) ?? 0) + 1 : 0);
              if (!parentId) rootObjectIds.add(createdObj.id);
              created++;
              await markRow(item.row.rowNumber, "imported", createdObj.id);
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

        const totalLevels = depthByObjectId.size ? Math.max(...Array.from(depthByObjectId.values())) + 1 : 0;
        const result = {
          status: "completed",
          summary: {
            total_rows: resolved.length,
            created,
            updated,
            skipped: rawRows.length - resolved.length,
            errors,
          },
          hierarchy: {
            root_objects: rootObjectIds.size,
            total_levels: totalLevels,
            total_objects: created + updated,
          },
          customer_id: fallbackCustomerId,
          cluster_id: clusterId,
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
