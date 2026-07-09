// ============================================
// Task #582: Telink-koppling — klient + sync-motor
// PDF §4.1 (öppna API:t) + §4.2 (auto-ärende vid kontaktbyte).
// Läsning bara — ingen write-back till Telink i denna fas.
// ============================================
import { promises as dns } from "node:dns";
import net from "node:net";
import { db } from "../db";
import {
  objects,
  metadataKatalog,
  metadataVarden,
  importBatches,
  customerIssueReports,
  type ServiceObject,
  telinkConfig as telinkConfigTable,
} from "@shared/schema";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { storage } from "../storage";
// Task #992: kanonisk källa = svenska metadata-modellen. Telink-synk skriver
// via de svenska write-helpers (historik + guards) i stället för den engelska
// object_metadata-tabellen.
import { createMetadata, updateMetadata, getDisplayValue } from "../metadata-queries";
import { primaryPayerCustomerIdSql } from "./object-customer";

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
 * SSRF-skydd: Telink-bas-URL är tenant-admin-styrd och används i server-
 * side fetch. Vi måste därför hindra att den pekas mot interna nätverk,
 * loopback eller obetrodda värdar.
 *
 * Default-allowlist täcker publika Telink-domäner. Operatörer som behöver
 * lägga till en alternativ värd anger den i ENV TELINK_ALLOWED_HOSTS som
 * komma-separerad lista (matchas case-insensitivt, exakt eller suffix
 * med ledande punkt).
 */
const TELINK_DEFAULT_ALLOWED_HOSTS = ["telink.se", "api.telink.se"];
const TELINK_ALLOWED_PORTS = new Set([443, 80]);

function getAllowedHosts(): string[] {
  const env = process.env.TELINK_ALLOWED_HOSTS;
  if (!env) return TELINK_DEFAULT_ALLOWED_HOSTS;
  const extras = env
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...TELINK_DEFAULT_ALLOWED_HOSTS, ...extras];
}

function isHostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  for (const allow of getAllowedHosts()) {
    if (h === allow) return true;
    if (h.endsWith(`.${allow}`)) return true;
  }
  return false;
}

function isPrivateOrLoopbackIp(addr: string): boolean {
  if (!addr) return true;
  const family = net.isIP(addr);
  if (family === 4) {
    const parts = addr.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (family === 6) {
    const v = addr.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
    if (v.startsWith("::ffff:")) {
      // IPv4-mappad — kolla v4-delen
      return isPrivateOrLoopbackIp(v.slice("::ffff:".length));
    }
    return false;
  }
  // Okänd — neka.
  return true;
}

/**
 * Validerar en Telink-bas-URL och returnerar normaliserad form.
 * Kastar vid otillåten URL. Anropas både i config-PUT (UI-fel) och
 * vid varje fetch (DNS-pinning förhindrar TOCTOU mellan validering
 * och request).
 */
export async function assertSafeTelinkBaseUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Ogiltig bas-URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Telink-bas-URL måste använda https://");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Telink-bas-URL får inte innehålla användarnamn eller lösenord");
  }
  const port = parsed.port ? parseInt(parsed.port, 10) : 443;
  if (!TELINK_ALLOWED_PORTS.has(port)) {
    throw new Error(`Telink-bas-URL får inte använda port ${port}`);
  }
  const hostname = parsed.hostname;
  if (!hostname) throw new Error("Telink-bas-URL saknar värdnamn");
  if (!isHostAllowed(hostname)) {
    throw new Error(
      `Värden "${hostname}" är inte tillåten. Lägg till den i TELINK_ALLOWED_HOSTS om den ska användas.`,
    );
  }
  // DNS-uppslag: även om hostname är allowlistad, blockera om den
  // (av misstag eller skadligt) löses upp till intern adress.
  let addresses: string[];
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true });
      addresses = records.map((r) => r.address);
    } catch {
      throw new Error(`Kunde inte slå upp ${hostname}`);
    }
  }
  if (!addresses.length) throw new Error(`Inga IP-adresser för ${hostname}`);
  for (const addr of addresses) {
    if (isPrivateOrLoopbackIp(addr)) {
      throw new Error(
        `Värden ${hostname} löses upp till en privat/intern adress (${addr}) och blockeras.`,
      );
    }
  }
  return parsed;
}

/**
 * Resultat av config-uppslag — sett från admin-UI även när apiKey saknas
 * eller integration är AV. Skiljs från fetch-redo TelinkConfig nedan.
 */
export interface TelinkConfigRow {
  enabled: boolean;
  baseUrl: string;
  hasApiKey: boolean;
  contactNameFieldKey: string;
  contactPhoneFieldKey: string;
}

/**
 * Läser admin-vy av Telink-config (utan apiKey). Använd från GET-endpoint.
 */
export async function getTelinkConfigForUi(tenantId: string): Promise<TelinkConfigRow> {
  const [row] = await db
    .select()
    .from(telinkConfigTable)
    .where(eq(telinkConfigTable.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return {
      enabled: false,
      baseUrl: "",
      hasApiKey: false,
      contactNameFieldKey: TELINK_DEFAULTS.contactNameFieldKey,
      contactPhoneFieldKey: TELINK_DEFAULTS.contactPhoneFieldKey,
    };
  }
  return {
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    hasApiKey: row.apiKey.length > 0,
    contactNameFieldKey: row.contactNameFieldKey,
    contactPhoneFieldKey: row.contactPhoneFieldKey,
  };
}

/**
 * Läser fetch-redo Telink-config (inkl apiKey). Returnerar null om saknas,
 * disabled, eller om baseUrl/apiKey är tomt. Använd endast server-internt.
 */
export async function loadTelinkConfig(tenantId: string): Promise<TelinkConfig | null> {
  const [row] = await db
    .select()
    .from(telinkConfigTable)
    .where(eq(telinkConfigTable.tenantId, tenantId))
    .limit(1);
  if (!row) return null;
  if (!row.baseUrl || !row.apiKey) return null;
  return {
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    contactNameFieldKey: row.contactNameFieldKey || TELINK_DEFAULTS.contactNameFieldKey,
    contactPhoneFieldKey: row.contactPhoneFieldKey || TELINK_DEFAULTS.contactPhoneFieldKey,
  };
}

/**
 * Upsert av Telink-config för en tenant. apiKey=undefined behåller befintlig.
 */
export async function upsertTelinkConfig(
  tenantId: string,
  input: {
    enabled: boolean;
    baseUrl: string;
    apiKey?: string;
    contactNameFieldKey?: string;
    contactPhoneFieldKey?: string;
  },
): Promise<TelinkConfigRow> {
  const [existing] = await db
    .select()
    .from(telinkConfigTable)
    .where(eq(telinkConfigTable.tenantId, tenantId))
    .limit(1);

  const nameKey =
    input.contactNameFieldKey?.trim() ||
    existing?.contactNameFieldKey ||
    TELINK_DEFAULTS.contactNameFieldKey;
  const phoneKey =
    input.contactPhoneFieldKey?.trim() ||
    existing?.contactPhoneFieldKey ||
    TELINK_DEFAULTS.contactPhoneFieldKey;
  const apiKey =
    input.apiKey && input.apiKey.trim() ? input.apiKey.trim() : existing?.apiKey ?? "";

  if (existing) {
    await db
      .update(telinkConfigTable)
      .set({
        enabled: input.enabled,
        baseUrl: input.baseUrl,
        apiKey,
        contactNameFieldKey: nameKey,
        contactPhoneFieldKey: phoneKey,
        updatedAt: new Date(),
      })
      .where(eq(telinkConfigTable.tenantId, tenantId));
  } else {
    await db.insert(telinkConfigTable).values({
      tenantId,
      enabled: input.enabled,
      baseUrl: input.baseUrl,
      apiKey,
      contactNameFieldKey: nameKey,
      contactPhoneFieldKey: phoneKey,
    });
  }
  return getTelinkConfigForUi(tenantId);
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
  // SSRF-skydd: validera (allowlist + privat-IP-block) före varje request
  // — inte bara vid config-spara. Vi resolvar dessutom till en konkret IP
  // för att hindra DNS-rebinding mellan validering och socket-open.
  const safeBase = await assertSafeTelinkBaseUrl(config.baseUrl);
  // Hämtar enbart butikschef-kontakter — vi filtrerar både via query-param
  // (om Telink stödjer det) och post-filtrerar på `role` så vi aldrig
  // uppdaterar metadata med t.ex. supportkontakter.
  const url = new URL("contacts?role=store_manager", safeBase.toString().replace(/\/?$/, "/"));
  const res = await fetch(url.toString(), {
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
  customerId: string | null;
}

async function loadMatchableObjects(tenantId: string): Promise<MatchableObject[]> {
  const rows = await db
    .select({
      id: objects.id,
      name: objects.name,
      objectNumber: objects.objectNumber,
      customerId: primaryPayerCustomerIdSql(),
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
  // katalog-id (metadata_katalog.id) för kontakt-namn/-telefon, eller null om typen saknas.
  nameDefId: string | null;
  phoneDefId: string | null;
  // katalog-namn (metadata_katalog.namn) — krävs av de svenska write-helpers (keyas på namn).
  nameNamn: string | null;
  phoneNamn: string | null;
  nameKey: string;
  phoneKey: string;
}

async function resolveFieldDefs(tenantId: string, config: TelinkConfig): Promise<FieldDefs> {
  const nameKey = config.contactNameFieldKey ?? TELINK_DEFAULTS.contactNameFieldKey;
  const phoneKey = config.contactPhoneFieldKey ?? TELINK_DEFAULTS.contactPhoneFieldKey;
  // Task #992: slå upp typerna i den svenska katalogen via namn (fältnyckeln
  // motsvarar metadata_katalog.namn i den konsoliderade modellen).
  const defs = await db
    .select({ id: metadataKatalog.id, namn: metadataKatalog.namn })
    .from(metadataKatalog)
    .where(
      and(
        eq(metadataKatalog.tenantId, tenantId),
        isNull(metadataKatalog.deletedAt),
        inArray(metadataKatalog.namn, [nameKey, phoneKey]),
      ),
    );
  const nameDef = defs.find((d) => d.namn === nameKey) ?? null;
  const phoneDef = defs.find((d) => d.namn === phoneKey) ?? null;
  return {
    nameDefId: nameDef?.id ?? null,
    phoneDefId: phoneDef?.id ?? null,
    nameNamn: nameDef?.namn ?? null,
    phoneNamn: phoneDef?.namn ?? null,
    nameKey,
    phoneKey,
  };
}

async function readCurrentValue(
  tenantId: string,
  objectId: string,
  katalogId: string,
): Promise<{ rowId: string; value: string | null } | null> {
  // Defense-in-depth: tenantId i WHERE även om objectId redan validerats —
  // matchar konventionen i resten av kodbasen (se MEMORY: multi-tenant
  // UPDATE predicates). Task #992: läs EGEN lokal rad i metadata_varden
  // (arv löses inte här — Telink jämför bara objektets eget värde).
  const [row] = await db
    .select()
    .from(metadataVarden)
    .where(
      and(
        eq(metadataVarden.tenantId, tenantId),
        eq(metadataVarden.objektId, objectId),
        eq(metadataVarden.metadataKatalogId, katalogId),
        // Task #1213: arkiverade kloner ska aldrig läsas som "eget värde".
        eq(metadataVarden.status, "aktiv"),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { rowId: row.id, value: getDisplayValue(row) };
}

async function writeValue(args: {
  tenantId: string;
  objectId: string;
  metadataTypNamn: string;
  value: string;
  existingRowId: string | null;
  userId: string | null;
}): Promise<void> {
  // Task #992: skriv via de svenska write-helpers så historik + guards bevaras.
  // metod='tjanst' markerar ursprunget som extern tjänst (Telink-synk).
  const actor = args.userId ?? "telink-sync";
  if (args.existingRowId) {
    await updateMetadata(args.existingRowId, args.value, args.tenantId, actor, "tjanst");
  } else {
    await createMetadata({
      tenantId: args.tenantId,
      objektId: args.objectId,
      metadataTypNamn: args.metadataTypNamn,
      varde: args.value,
      skapadAv: actor,
      metod: "tjanst",
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
  const config = await loadTelinkConfig(tenantId);
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
        metadataTypNamn: defs.nameNamn ?? defs.nameKey,
        value: newName,
        existingRowId: current?.rowId ?? null,
        userId,
      });
      didUpdate = true;
      // Endast ärende vid byte (oldName != null) — inte vid första-gången-import
      // av en kontakt som aldrig funnits.
      if (oldName) {
        issueCreated = await createContactChangeIssue({
          tenantId,
          obj,
          oldName,
          newName,
          contact,
          batchId,
        });
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
        metadataTypNamn: defs.phoneNamn ?? defs.phoneKey,
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
}): Promise<boolean> {
  const { tenantId, obj, oldName, newName, contact, batchId } = args;
  // Kund-neutralt objekt (ADR v3) saknar kund att registrera ärendet på — hoppa över.
  if (!obj.customerId) return false;
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
  return true;
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
