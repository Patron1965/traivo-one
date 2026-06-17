// ============================================================================
// Metadata-editor ("Metadata Lämnare") — godkännande + katalog-provisionering
// ----------------------------------------------------------------------------
// Task #956. Hanterar två känsliga operationer:
//   1. provisionKatalogField — skapar ivrigt ett flervärde-katalogfält när admin
//      väljer "skapa nytt fält" i editor-byggaren.
//   2. approveSubmission / rejectSubmission — granskningskön. Värden skrivs till
//      objektet ENDAST vid godkännande, via den svenska katalog-vägen
//      (createMetadata, flervärde-append). Statusövergången är atomisk så att
//      en inlämning aldrig kan dubbel-godkännas (och därmed dubbelskrivas).
// ============================================================================

import { db } from "../db";
import { and, eq } from "drizzle-orm";
import {
  metadataEditorSubmissions,
  metadataEditorSubmissionValues,
  metadataEditorFields,
  metadataKatalog,
  type MetadataKatalog,
  type MetadataEditorFieldKind,
} from "@shared/schema";
import { createMetadata } from "../metadata-queries";

const METADATA_EDITOR_METHOD = "metadata_editor";
const KATALOG_AREA = "Metadata Lämnare";

/** Drizzle datatyp för respektive editor-fält-kind. */
export function katalogDatatypForKind(kind: MetadataEditorFieldKind): string {
  switch (kind) {
    case "rating":
      return "integer";
    case "text":
      return "string";
    case "photo":
      return "json";
    default:
      return "string";
  }
}

/**
 * Hitta ett ledigt (unikt per tenant) katalog-namn baserat på admins etikett.
 * Lägger till " (2)", " (3)" … vid kollision mot aktiva katalogposter.
 */
async function resolveUniqueKatalogNamn(tenantId: string, base: string): Promise<string> {
  const trimmed = base.trim().slice(0, 90) || "Metadata";
  const existing = await db
    .select({ namn: metadataKatalog.namn })
    .from(metadataKatalog)
    .where(eq(metadataKatalog.tenantId, tenantId));
  const taken = new Set(existing.map((r) => r.namn.toLowerCase()));
  if (!taken.has(trimmed.toLowerCase())) return trimmed;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${trimmed} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${trimmed} (${Date.now()})`;
}

/**
 * Skapa ivrigt ett flervärde-katalogfält för ett editor-fält ("skapa nytt").
 * allowDuplicates=true så att upprepade inlämningar ackumuleras; arLogisk=false
 * (rent informativt); isSystem=false så att den manuella godkänd-skrivningen
 * tillåts av createMetadata.
 */
export async function provisionKatalogField(params: {
  tenantId: string;
  label: string;
  kind: MetadataEditorFieldKind;
  beteckning?: string | null;
}): Promise<MetadataKatalog> {
  const namn = await resolveUniqueKatalogNamn(params.tenantId, params.label);
  const [row] = await db
    .insert(metadataKatalog)
    .values({
      tenantId: params.tenantId,
      namn,
      datatyp: katalogDatatypForKind(params.kind),
      arLogisk: false,
      standardArvs: false,
      kategori: "beskrivning",
      area: KATALOG_AREA,
      allowDuplicates: true,
      isSystem: false,
      beteckning: params.beteckning?.trim()?.slice(0, 30) || null,
    })
    .returning();
  return row;
}

/**
 * Validera att ett befintligt katalogfält får tas emot av en metadata-editor.
 * Beräknade och systemfält är read-only/auto och får aldrig matas av publika
 * inlämningar. Arkiverade fält avvisas också.
 */
export async function assertKatalogMappable(katalogId: string, tenantId: string): Promise<MetadataKatalog> {
  const [row] = await db
    .select()
    .from(metadataKatalog)
    .where(and(eq(metadataKatalog.id, katalogId), eq(metadataKatalog.tenantId, tenantId)));
  if (!row) {
    throw new Error("Metadatafältet hittades inte för denna organisation.");
  }
  if (row.deletedAt) {
    throw new Error(`"${row.namn}" är arkiverat och kan inte tas emot av en metadata-lämnare.`);
  }
  if (row.isSystem) {
    throw new Error(`"${row.namn}" är ett systemfält och kan inte fyllas i via en metadata-lämnare.`);
  }
  if (row.arBeraknad) {
    throw new Error(`"${row.namn}" är ett beräknat fält och kan inte fyllas i via en metadata-lämnare.`);
  }
  return row;
}

export interface ApproveResult {
  submissionId: string;
  writtenValueCount: number;
}

/**
 * Godkänn en inlämning: skriv alla värden till objektet via katalog-vägen.
 *
 * Statusövergången pending→approved görs som ett atomiskt UPDATE … WHERE
 * status='pending' så att två samtidiga godkännanden inte kan dubbelskriva. Om
 * en värde-skrivning fallerar återställs statusen till pending (redan skrivna
 * värden behåller writtenMetadataValueId och hoppas vid omförsök → idempotent).
 */
export async function approveSubmission(params: {
  submissionId: string;
  tenantId: string;
  reviewerId?: string | null;
  reviewNotes?: string | null;
}): Promise<ApproveResult> {
  const { submissionId, tenantId } = params;

  const [submission] = await db
    .select()
    .from(metadataEditorSubmissions)
    .where(and(eq(metadataEditorSubmissions.id, submissionId), eq(metadataEditorSubmissions.tenantId, tenantId)));
  if (!submission) {
    throw new Error("Inlämningen hittades inte.");
  }
  if (submission.status !== "pending") {
    throw new Error("Inlämningen är redan hanterad.");
  }
  if (!submission.objectId) {
    throw new Error("Inlämningen saknar objekt och kan inte godkännas.");
  }

  // Atomiskt anspråk: endast en godkännare kan flippa pending→approved.
  const [claimed] = await db
    .update(metadataEditorSubmissions)
    .set({
      status: "approved",
      reviewedBy: params.reviewerId ?? null,
      reviewedAt: new Date(),
      reviewNotes: params.reviewNotes ?? null,
    })
    .where(
      and(
        eq(metadataEditorSubmissions.id, submissionId),
        eq(metadataEditorSubmissions.tenantId, tenantId),
        eq(metadataEditorSubmissions.status, "pending"),
      ),
    )
    .returning();
  if (!claimed) {
    throw new Error("Inlämningen är redan hanterad.");
  }

  const objectId = submission.objectId;
  const values = await db
    .select()
    .from(metadataEditorSubmissionValues)
    .where(and(eq(metadataEditorSubmissionValues.submissionId, submissionId), eq(metadataEditorSubmissionValues.tenantId, tenantId)));

  // Fält-kind per värde (foto vs rating/text) — styr hur värdet coercas.
  const fields = await db
    .select()
    .from(metadataEditorFields)
    .where(and(eq(metadataEditorFields.editorId, submission.editorId), eq(metadataEditorFields.tenantId, tenantId)));
  const kindByFieldId = new Map(fields.map((f) => [f.id, f.kind as MetadataEditorFieldKind]));

  const skapadAv = submission.reporterName?.trim() || "metadata-editor";
  let writtenValueCount = 0;

  try {
    for (const value of values) {
      if (value.writtenMetadataValueId) {
        writtenValueCount++;
        continue; // redan skrivet (omförsök) → idempotent
      }
      if (!value.metadataKatalogId) continue;

      // Läs upp katalognamn (createMetadata slår upp typ via namn) + validera mappbarhet.
      const katalog = await assertKatalogMappable(value.metadataKatalogId, tenantId);

      const kind = value.fieldId ? kindByFieldId.get(value.fieldId) : undefined;
      let varde: string | number | boolean | Date | Record<string, unknown> | null;
      if (kind === "photo") {
        varde = { photos: value.photoPaths ?? [] };
      } else {
        varde = value.valueJson as string | number | null;
      }
      if (varde === null || varde === undefined) continue;

      const created = await createMetadata({
        tenantId,
        objektId: objectId,
        metadataTypNamn: katalog.namn,
        varde,
        skapadAv,
        metod: METADATA_EDITOR_METHOD,
      });

      await db
        .update(metadataEditorSubmissionValues)
        .set({ writtenMetadataValueId: created.id })
        .where(and(eq(metadataEditorSubmissionValues.id, value.id), eq(metadataEditorSubmissionValues.tenantId, tenantId)));
      writtenValueCount++;
    }
  } catch (err) {
    // Återställ till pending så planeraren kan rätta och försöka igen. Redan
    // skrivna värden är stämplade och hoppas vid omförsök.
    await db
      .update(metadataEditorSubmissions)
      .set({ status: "pending", reviewedBy: null, reviewedAt: null })
      .where(and(eq(metadataEditorSubmissions.id, submissionId), eq(metadataEditorSubmissions.tenantId, tenantId)));
    throw err;
  }

  return { submissionId, writtenValueCount };
}

/** Avvisa en inlämning (atomiskt pending→rejected). */
export async function rejectSubmission(params: {
  submissionId: string;
  tenantId: string;
  reviewerId?: string | null;
  reviewNotes?: string | null;
}): Promise<void> {
  const [claimed] = await db
    .update(metadataEditorSubmissions)
    .set({
      status: "rejected",
      reviewedBy: params.reviewerId ?? null,
      reviewedAt: new Date(),
      reviewNotes: params.reviewNotes ?? null,
    })
    .where(
      and(
        eq(metadataEditorSubmissions.id, params.submissionId),
        eq(metadataEditorSubmissions.tenantId, params.tenantId),
        eq(metadataEditorSubmissions.status, "pending"),
      ),
    )
    .returning();
  if (!claimed) {
    throw new Error("Inlämningen är redan hanterad.");
  }
}
