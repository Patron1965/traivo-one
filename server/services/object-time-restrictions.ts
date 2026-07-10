// Etapp 5 (Task #1217): metadata-backad vy över tidsrestriktioner.
// Tabellen object_time_restrictions är borttagen — källan är metadata-fältet
// "Tidsrestriktioner" (area 'tid', datatyp json) i metadata_katalog, läst
// arvs-medvetet via getObjectsMetadataValuesForCatalog. Motorerna (VRP,
// planner, AI) läser denna vy; formen speglar den gamla tabellraden så att
// constraint-logiken är oförändrad.
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getObjectsMetadataValuesForCatalog } from "../metadata-queries";

export interface ObjectTimeRestrictionView {
  id: string;
  tenantId: string;
  objectId: string;
  restrictionType: string;
  description: string | null;
  weekdays: number[] | null;
  startTime: string | null;
  endTime: string | null;
  isBlockingAllDay: boolean | null;
  validFromDate: Date | null;
  validToDate: Date | null;
  recurrenceInterval: number | null;
  recurrenceUnit: string | null;
  preference: string;
  reason: string | null;
  isActive: boolean | null;
  createdAt: Date | null;
}

const KATALOG_NAMN = "Tidsrestriktioner";

async function getKatalogId(tenantId: string): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT id FROM metadata_katalog
    WHERE tenant_id = ${tenantId} AND namn = ${KATALOG_NAMN} AND deleted_at IS NULL
    LIMIT 1
  `);
  const row = (res.rows as any[])[0];
  return row ? String(row.id) : null;
}

function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = new Date(value as any);
  return isNaN(d.getTime()) ? null : d;
}

function toIntArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .map((v) => (typeof v === "number" ? v : parseInt(String(v), 10)))
    .filter((n) => Number.isFinite(n));
  return out;
}

function parseEntries(
  tenantId: string,
  objectId: string,
  jsonText: string,
): ObjectTimeRestrictionView[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : parsed != null && typeof parsed === "object" ? [parsed] : [];
  const views: ObjectTimeRestrictionView[] = [];
  arr.forEach((entry, idx) => {
    if (entry == null || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    if (e.isActive === false) return;
    const restrictionType = typeof e.restrictionType === "string" && e.restrictionType.trim() !== ""
      ? e.restrictionType
      : "access_restriction";
    views.push({
      id: typeof e.id === "string" && e.id !== "" ? e.id : `${objectId}:tidsrestriktion:${idx}`,
      tenantId,
      objectId,
      restrictionType,
      description: typeof e.description === "string" ? e.description : null,
      weekdays: toIntArray(e.weekdays) ?? [],
      startTime: typeof e.startTime === "string" ? e.startTime : null,
      endTime: typeof e.endTime === "string" ? e.endTime : null,
      isBlockingAllDay: e.isBlockingAllDay === true,
      validFromDate: toDate(e.validFromDate),
      validToDate: toDate(e.validToDate),
      recurrenceInterval: typeof e.recurrenceInterval === "number" ? e.recurrenceInterval : null,
      recurrenceUnit: typeof e.recurrenceUnit === "string" ? e.recurrenceUnit : null,
      preference: typeof e.preference === "string" && e.preference !== "" ? e.preference : "unfavorable",
      reason: typeof e.reason === "string" ? e.reason : null,
      isActive: true,
      createdAt: null,
    });
  });
  return views;
}

/** Arvs-medveten läsning av tidsrestriktioner för givna objekt. */
export async function getTimeRestrictionsForObjects(
  tenantId: string,
  objectIds: string[],
): Promise<ObjectTimeRestrictionView[]> {
  if (objectIds.length === 0) return [];
  const katalogId = await getKatalogId(tenantId);
  if (!katalogId) return [];
  const values = await getObjectsMetadataValuesForCatalog(tenantId, objectIds, [katalogId]);
  const out: ObjectTimeRestrictionView[] = [];
  for (const objectId of Object.keys(values)) {
    const jsonText = values[objectId]?.[katalogId];
    if (!jsonText) continue;
    out.push(...parseEntries(tenantId, objectId, jsonText));
  }
  return out;
}

/** Tidsrestriktioner för ETT objekt. */
export async function getTimeRestrictionsForObject(
  tenantId: string,
  objectId: string,
): Promise<ObjectTimeRestrictionView[]> {
  return getTimeRestrictionsForObjects(tenantId, [objectId]);
}

/**
 * Tenant-vid läsning. OBS: arvs-upplösning körs för alla aktiva objekt —
 * använd hellre getTimeRestrictionsForObjects när objekt-mängden är känd.
 */
export async function getTimeRestrictionsForTenant(
  tenantId: string,
): Promise<ObjectTimeRestrictionView[]> {
  const katalogId = await getKatalogId(tenantId);
  if (!katalogId) return [];
  // Begränsa till objekt som har värdet lokalt ELLER har en förälder — för
  // enkelhet: alla aktiva objekt i tenanten (arv kan träffa vilket som helst).
  const res = await db.execute(sql`
    SELECT id FROM objects
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
  `);
  const objectIds = (res.rows as any[]).map((r) => String(r.id));
  if (objectIds.length === 0) return [];
  const values = await getObjectsMetadataValuesForCatalog(tenantId, objectIds, [katalogId]);
  const out: ObjectTimeRestrictionView[] = [];
  for (const objectId of Object.keys(values)) {
    const jsonText = values[objectId]?.[katalogId];
    if (!jsonText) continue;
    out.push(...parseEntries(tenantId, objectId, jsonText));
  }
  return out;
}
