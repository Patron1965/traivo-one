// ============================================
// Task #582: Telink-koppling — klient + sync-motor
// PDF §4.1 (öppna API:t) + §4.2 (auto-ärende vid kontaktbyte).
// Läsning bara — ingen write-back till Telink i denna fas.
// ============================================
import { db } from "../db";
import {
  objects,
  metadataDefinitions,
  objectMetadata,
  importBatches,
  customerIssueReports,
  type ServiceObject,
} from "@shared/schema";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { storage } from "../storage";

export interface TelinkConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  contactNameFieldKey?: string;
  contactPhoneFieldKey?: string;
}

export interface TelinkContactRecord {
  externalId?: string | null;
  objectNumber?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface TelinkSyncResult {
  batchId: string;
  fetched: number;
  matched: number;
  updated: number;
  unchanged: number;
  unmatched: number;
  issuesCreated: number;
  errors: string[];
}

export const TELINK_DEFAULTS = {
  contactNameFieldKey: "kontakt_namn",
  contactPhoneFieldKey: "kontakt_telefon",
} as const;

/**
 * Plockar Telink-config från tenant.settings. Returnerar null om saknas
 * eller inte aktiverad.
 */
export function readTelinkConfig(settings: unknown): TelinkConfig | null {
  if (!settings || typeof settings !== "object") return null;
  const raw = (settings as Record<string, unknown>).telink;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const enabled = r.enabled === true;
  const baseUrl = typeof r.baseUrl === "string" ? r.baseUrl.trim() : "";
  const apiKey = typeof r.apiKey === "string" ? r.apiKey : "";
  if (!baseUrl || !apiKey) return null;
  return {
    enabled,
    baseUrl,
    apiKey,
    contactNameFieldKey:
      typeof r.contactNameFieldKey === "string" && r.contactNameFieldKey.trim()
        ? r.contactNameFieldKey.trim()
        : TELINK_DEFAULTS.contactNameFieldKey,
    contactPhoneFieldKey:
      typeof r.contactPhoneFieldKey === "string" && r.contactPhoneFieldKey.trim()
        ? r.contactPhoneFieldKey.trim()
        : TELINK_DEFAULTS.contactPhoneFieldKey,
  };
}

/**
 * Hämtar butikschef-kontakter från Telink. Förväntad form:
 *   GET {baseUrl}/contacts?role=store_manager
 *   Authorization: Bearer <apiKey>
 *   200: [{ externalId, objectNumber, name, phone, email, role }, ...]
 *
 * Implementationen är tolerant: accepterar både array och {data:[...]}
 * samt mappar synonyma fältnamn (extern_id, object_number, contact_name etc).
 */
export async function fetchTelinkContacts(
  config: TelinkConfig,
  opts: { signal?: AbortSignal } = {},
): Promise<TelinkContactRecord[]> {
  // Hämtar enbart butikschef-kontakter — vi filtrerar både via query-param
  // (om Telink stödjer det) och post-filtrerar på `role` så vi aldrig
  // uppdaterar metadata med t.ex. supportkontakter.
  const url = config.baseUrl.replace(/\/+$/, "") + "/contacts?role=store_manager";
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
    },
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Telink API ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }
  const json = (await res.json()) as unknown;
  const rows: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { data?: unknown[] }).data)
      ? ((json as { data: unknown[] }).data)
      : [];
  const out: TelinkContactRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name =
      pickString(r, ["name", "contactName", "contact_name", "fullName", "full_name"]) ?? "";
    if (!name) continue;
    const role = pickString(r, ["role", "title"]);
    // Hård post-filter: behåll bara butikschefer även om Telink-API:t
    // ignorerar query-paramen. Saknad roll → släpps igenom (vissa
    // installationer returnerar inte role-fältet alls).
    if (role && !isStoreManagerRole(role)) continue;
    out.push({
      externalId: pickString(r, ["externalId", "external_id", "id"]),
      objectNumber: pickString(r, [
        "objectNumber",
        "object_number",
        "storeNumber",
        "store_number",
      ]),
      name,
      phone: pickString(r, ["phone", "phoneNumber", "phone_number", "tel"]),
      email: pickString(r, ["email", "e_mail"]),
      role,
    });
  }
  return out;
}

function isStoreManagerRole(role: string): boolean {
  const r = role.trim().toLowerCase();
  return (
    r === "store_manager" ||
    r === "store manager" ||
    r === "butikschef" ||
    r.includes("butikschef") ||
    r.includes("store_manager") ||
    r.includes("store manager")
  );
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

interface MatchableObject {
  id: string;
  name: string;
  objectNumber: string | null;
  customerId: string;
}

async function loadMatchableObjects(tenantId: string): Promise<MatchableObject[]> {
  const rows = await db
    .select({
      id: objects.id,
      name: objects.name,
      objectNumber: objects.objectNumber,
      customerId: objects.customerId,
    })
    .from(objects)
    .where(and(eq(objects.tenantId, tenantId), isNull(objects.deletedAt)));
  return rows;
}

function indexByObjectNumber(rows: MatchableObject[]): Map<string, MatchableObject> {
  const m = new Map<string, MatchableObject>();
  for (const r of rows) {
    if (r.objectNumber) m.set(r.objectNumber.trim().toLowerCase(), r);
  }
  return m;
}

interface FieldDefs {
  nameDefId: string | null;
  phoneDefId: string | null;
  nameKey: string;
  phoneKey: string;
}

async function resolveFieldDefs(tenantId: string, config: TelinkConfig): Promise<FieldDefs> {
  const nameKey = config.contactNameFieldKey ?? TELINK_DEFAULTS.contactNameFieldKey;
  const phoneKey = config.contactPhoneFieldKey ?? TELINK_DEFAULTS.contactPhoneFieldKey;
  const defs = await db
    .select({ id: metadataDefinitions.id, fieldKey: metadataDefinitions.fieldKey })
    .from(metadataDefinitions)
    .where(
      and(
        eq(metadataDefinitions.tenantId, tenantId),
        isNull(metadataDefinitions.deletedAt),
        inArray(metadataDefinitions.fieldKey, [nameKey, phoneKey]),
      ),
    );
  const nameDef = defs.find((d) => d.fieldKey === nameKey) ?? null;
  const phoneDef = defs.find((d) => d.fieldKey === phoneKey) ?? null;
  return {
    nameDefId: nameDef?.id ?? null,
    phoneDefId: phoneDef?.id ?? null,
    nameKey,
    phoneKey,
  };
}

async function readCurrentValue(
  tenantId: string,
  objectId: string,
  definitionId: string,
): Promise<{ rowId: string; value: string | null } | null> {
  // Defense-in-depth: tenantId i WHERE även om objectId redan validerats —
  // matchar konventionen i resten av kodbasen (se MEMORY: multi-tenant
  // UPDATE predicates).
  const [row] = await db
    .select({ id: objectMetadata.id, value: objectMetadata.value })
    .from(objectMetadata)
    .where(
      and(
        eq(objectMetadata.tenantId, tenantId),
        eq(objectMetadata.objectId, objectId),
        eq(objectMetadata.definitionId, definitionId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { rowId: row.id, value: row.value ?? null };
}

async function writeValue(args: {
  tenantId: string;
  objectId: string;
  definitionId: string;
  value: string;
  existingRowId: string | null;
  userId: string | null;
}): Promise<void> {
  if (args.existingRowId) {
    await db
      .update(objectMetadata)
      .set({ value: args.value, updatedAt: new Date(), updatedBy: args.userId ?? "telink-sync" })
      .where(
        and(
          eq(objectMetadata.id, args.existingRowId),
          eq(objectMetadata.objectId, args.objectId),
          eq(objectMetadata.tenantId, args.tenantId),
        ),
      );
  } else {
    await db.insert(objectMetadata).values({
      tenantId: args.tenantId,
      objectId: args.objectId,
      definitionId: args.definitionId,
      value: args.value,
      updatedBy: args.userId ?? "telink-sync",
    });
  }
}

/**
 * Synkar Telink-kontakter mot Traivos objekt för en tenant. Skapar ärende
 * vid varje verklig kontaktbytes-händelse. Loggar i import_batches.
 *
 * @param mode "scheduled" = nattlig körning, "manual" = admin tryckte synka.
 * @param objectIdScope om angiven: begränsa till exakt detta objekt.
 */
export async function runTelinkSyncForTenant(
  tenantId: string,
  opts: {
    mode: "scheduled" | "manual";
    objectIdScope?: string;
    userId?: string | null;
  },
): Promise<TelinkSyncResult> {
  const tenant = await storage.getTenant(tenantId);
  if (!tenant) {
    throw new Error("Tenant saknas");
  }
  const config = readTelinkConfig(tenant.settings);
  if (!config) {
    throw new Error("Telink-konfiguration saknas eller är ofullständig");
  }
  if (!config.enabled && opts.mode === "scheduled") {
    return {
      batchId: "",
      fetched: 0,
      matched: 0,
      updated: 0,
      unchanged: 0,
      unmatched: 0,
      issuesCreated: 0,
      errors: ["Telink-integration inaktiverad för denna tenant"],
    };
  }

  const batchId = `telink-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result: TelinkSyncResult = {
    batchId,
    fetched: 0,
    matched: 0,
    updated: 0,
    unchanged: 0,
    unmatched: 0,
    issuesCreated: 0,
    errors: [],
  };

  let contacts: TelinkContactRecord[] = [];
  try {
    contacts = await fetchTelinkContacts(config);
    result.fetched = contacts.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Telink-hämtning misslyckades: ${msg}`);
    await logBatch(tenantId, batchId, result, opts.mode);
    return result;
  }

  const allObjects = await loadMatchableObjects(tenantId);
  const scopedObjects = opts.objectIdScope
    ? allObjects.filter((o) => o.id === opts.objectIdScope)
    : allObjects;
  const byNum = indexByObjectNumber(scopedObjects);
  const defs = await resolveFieldDefs(tenantId, config);

  if (!defs.nameDefId) {
    result.errors.push(
      `Metadata-fält "${defs.nameKey}" saknas — skapa det i metadata-konfigurationen först.`,
    );
    await logBatch(tenantId, batchId, result, opts.mode);
    return result;
  }

  for (const contact of contacts) {
    const obj = matchObject(contact, byNum);
    if (!obj) {
      // Om vi skoppat till ett specifikt objekt och kontakten inte matchar,
      // räkna inte som "unmatched" — det är ointressant.
      if (!opts.objectIdScope) result.unmatched += 1;
      continue;
    }
    result.matched += 1;
    try {
      const changed = await applyContactToObject({
        tenantId,
        obj,
        contact,
        defs,
        userId: opts.userId ?? null,
        batchId,
      });
      if (changed.didUpdate) result.updated += 1;
      else result.unchanged += 1;
      if (changed.issueCreated) result.issuesCreated += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Objekt ${obj.name}: ${msg}`);
    }
  }

  await logBatch(tenantId, batchId, result, opts.mode);
  return result;
}

function matchObject(
  contact: TelinkContactRecord,
  byNum: Map<string, MatchableObject>,
): MatchableObject | null {
  // Telink kan returnera matchnyckel som "externalId" (det vi tidigare lagrat
  // som butikens ID) eller "objectNumber" — bägge tolkas mot objects.objectNumber.
  const candidates = [contact.externalId, contact.objectNumber];
  for (const c of candidates) {
    if (!c) continue;
    const hit = byNum.get(c.trim().toLowerCase());
    if (hit) return hit;
  }
  return null;
}

async function applyContactToObject(args: {
  tenantId: string;
  obj: MatchableObject;
  contact: TelinkContactRecord;
  defs: FieldDefs;
  userId: string | null;
  batchId: string;
}): Promise<{ didUpdate: boolean; issueCreated: boolean }> {
  const { tenantId, obj, contact, defs, userId, batchId } = args;
  let didUpdate = false;
  let issueCreated = false;

  // Namn — primär trigger för auto-ärende
  if (defs.nameDefId) {
    const current = await readCurrentValue(tenantId, obj.id, defs.nameDefId);
    const oldName = current?.value?.trim() ?? null;
    const newName = contact.name.trim();
    if (oldName !== newName) {
      await writeValue({
        tenantId,
        objectId: obj.id,
        definitionId: defs.nameDefId,
        value: newName,
        existingRowId: current?.rowId ?? null,
        userId,
      });
      didUpdate = true;
      // Endast ärende vid byte (oldName != null) — inte vid första-gången-import
      // av en kontakt som aldrig funnits.
      if (oldName) {
        await createContactChangeIssue({
          tenantId,
          obj,
          oldName,
          newName,
          contact,
          batchId,
        });
        issueCreated = true;
      }
    }
  }

  // Telefon — uppdatera tyst utan ärende
  if (defs.phoneDefId && contact.phone) {
    const current = await readCurrentValue(tenantId, obj.id, defs.phoneDefId);
    const oldPhone = current?.value?.trim() ?? null;
    const newPhone = contact.phone.trim();
    if (oldPhone !== newPhone) {
      await writeValue({
        tenantId,
        objectId: obj.id,
        definitionId: defs.phoneDefId,
        value: newPhone,
        existingRowId: current?.rowId ?? null,
        userId,
      });
      didUpdate = true;
    }
  }

  return { didUpdate, issueCreated };
}

async function createContactChangeIssue(args: {
  tenantId: string;
  obj: MatchableObject;
  oldName: string;
  newName: string;
  contact: TelinkContactRecord;
  batchId: string;
}): Promise<void> {
  const { tenantId, obj, oldName, newName, contact, batchId } = args;
  const lines: string[] = [];
  lines.push(`Ny kontakt enligt Telink: ${newName} (tidigare ${oldName}).`);
  if (contact.role) lines.push(`Roll: ${contact.role}`);
  if (contact.phone) lines.push(`Telefon: ${contact.phone}`);
  if (contact.email) lines.push(`E-post: ${contact.email}`);
  lines.push(`Källa: Telink-synkronisering (batch ${batchId}).`);

  await db.insert(customerIssueReports).values({
    tenantId,
    customerId: obj.customerId,
    objectId: obj.id,
    issueType: "other",
    priority: "normal",
    status: "open",
    title: `Ny butikschef: ${newName} på ${obj.name}`,
    description: lines.join("\n"),
    customerContact: newName,
  });
}

async function logBatch(
  tenantId: string,
  batchId: string,
  result: TelinkSyncResult,
  mode: "scheduled" | "manual",
): Promise<void> {
  try {
    await db.insert(importBatches).values({
      tenantId,
      batchId,
      totalRows: result.fetched,
      created: result.issuesCreated,
      updated: result.updated,
      errors: result.errors.length,
      metadata: {
        type: "telink-sync",
        source: mode,
        matched: result.matched,
        unmatched: result.unmatched,
        unchanged: result.unchanged,
        issuesCreated: result.issuesCreated,
        errorMessages: result.errors.slice(0, 20),
      },
    });
  } catch (err) {
    // Logg-fel ska inte rivka själva synken.
    console.error("[telink-sync] kunde inte skriva import_batches", err);
  }
}
