// Task #1215 (Etapp 3) — Uppgiftspaketet: den operativa arbetskopian.
// ============================================================================
// EN delad service för att FYLLA uppgiftspaketet vid all uppgiftsskapning och
// UPPDATERA det för öppna/framtida uppgifter när objektets metadata ändras.
// Motorerna ska läsa paketet — inte objektet.
//
//  - Geografimotorns kontrakt: PRIMÄR plats (körbar, ruttbar) härleds via
//    objektets platsmodell (object-location.ts — enda källan; kolumnerna är den
//    ruttbara cachen som geo-field-sync håller i synk med metadatat), och
//    SEKUNDÄR plats (utförandeplats, aldrig ruttbar) härleds från Geografi-
//    metadatat (Fördjupad position + Avdelning/Port/Våning, arvs-medvetet).
//  - Frysta fakta: uppgifter vars kanoniska status (deriveUppgiftStatus — enda
//    mappningen) nått "utford" eller senare röres ALDRIG (isUppgiftFrozen).
//  - Spegelsynk: tekniska spegelkolumner (assignments.address/latitude/longitude,
//    work_orders.taskLatitude/taskLongitude) uppdateras present-value-only från
//    samma paketbygge — generaliserar geo-field-sync-mönstret till uppgiftslagret.
//
// Skapande-fyllnaden är BEST-EFFORT: den får aldrig blockera en insert — fel
// loggas och uppgiften skapas utan paket (legacy-beteende).
import { db } from "../db";
import { objects, workOrders, assignments } from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  UPPGIFTSPAKET_VERSION,
  deriveUppgiftStatus,
  isUppgiftFrozen,
  type Uppgiftspaket,
  type UppgiftspaketPrimarPlats,
  type UppgiftspaketSekundarPlats,
  type UppgiftspaketAtkomst,
  type InvoiceQueueState,
} from "@shared/uppgift-contract";
import { resolveObjectLocation } from "./object-location";

// ============================================================================
// GEOGRAFIMOTORNS KONTRAKT — primär (körbar) + sekundär (utförandeplats)
// ============================================================================

export interface UppgiftGeografi {
  primar: UppgiftspaketPrimarPlats;
  sekundar: UppgiftspaketSekundarPlats | null;
}

type ObjectRowForPaket = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  entranceLatitude: number | null;
  entranceLongitude: number | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  addressDescriptor: string | null;
  polylineData: unknown;
  locationType: string | null;
};

async function getObjectRowForPaket(
  tenantId: string,
  objectId: string,
): Promise<ObjectRowForPaket | null> {
  const [row] = await db
    .select({
      id: objects.id,
      latitude: objects.latitude,
      longitude: objects.longitude,
      entranceLatitude: objects.entranceLatitude,
      entranceLongitude: objects.entranceLongitude,
      address: objects.address,
      city: objects.city,
      postalCode: objects.postalCode,
      addressDescriptor: objects.addressDescriptor,
      polylineData: objects.polylineData,
      locationType: objects.locationType,
    })
    .from(objects)
    .where(and(eq(objects.id, objectId), eq(objects.tenantId, tenantId)))
    .limit(1);
  return (row as ObjectRowForPaket | undefined) ?? null;
}

/**
 * Härleder geografikontraktet för ett objekt.
 *  - PRIMÄR: resolveObjectLocation över objektets ruttbara kolumn-cache
 *    (pinpoint/area/none, entré-koord som ruttbar fallback) — kolumnerna hålls
 *    i synk med Geografi-metadatat av geo-field-sync (enkelriktad cache).
 *  - SEKUNDÄR: Fördjupad position + Avdelning/Port/Våning läses arvs-medvetet
 *    DIREKT ur metadata-katalogen (getObjectGeoFields) — aldrig ruttbar.
 */
export async function resolveUppgiftGeografi(
  tenantId: string,
  objectId: string,
  preloadedObject?: ObjectRowForPaket | null,
): Promise<UppgiftGeografi | null> {
  const obj = preloadedObject ?? (await getObjectRowForPaket(tenantId, objectId));
  if (!obj) return null;

  const loc = resolveObjectLocation(obj as any);
  const primar: UppgiftspaketPrimarPlats = {
    adress: loc.address,
    latitude: loc.latitude,
    longitude: loc.longitude,
    ruttbar: loc.routable,
    platstyp: loc.locationType,
    ...(loc.routable ? {} : { orsak: loc.reason }),
  };

  // Sekundär utförandeplats ur metadatat (arvs-medvetet). Best-effort: läsfel
  // här får inte fälla paketbygget — primär plats är alltid användbar ensam.
  let sekundar: UppgiftspaketSekundarPlats | null = null;
  try {
    // Dynamisk import — metadata-queries är en tung modul och laddar själv
    // services lazy; samma mönster som metadata-change-jobs för att undvika cykler.
    const { getObjectGeoFields } = await import("../metadata-queries");
    const geo = await getObjectGeoFields(objectId, tenantId);
    const fp = geo.advancedPosition.fordjupadPosition;
    const apv = geo.advancedPosition.avdelningPortVaning;
    const beskrivning = apv.source !== "missing" ? (apv.value ?? null) : null;
    const geometri = fp.source !== "missing" ? (fp.json ?? null) : null;
    const punkt = fp.source !== "missing" ? fp.point : null;
    if (geometri != null || punkt != null || beskrivning != null) {
      sekundar = { punkt, geometri, beskrivning };
    }
  } catch (err) {
    console.error(
      `[uppgiftspaket] sekundär plats kunde inte läsas för objekt ${objectId}:`,
      err,
    );
  }

  return { primar, sekundar };
}

// ============================================================================
// PAKETFYLLNAD (skapande + propagering delar samma bygge)
// ============================================================================

export interface BuildUppgiftspaketArgs {
  tenantId: string;
  objectId?: string | null;
  /** Önskad leveranstid/tidsfönster (från caller — koncept/order/motor). */
  tidsfonsterStart?: Date | string | null;
  tidsfonsterSlut?: Date | string | null;
  antal?: number | null;
  utforandekod?: string | null;
  tidskod?: string | null;
  kundId?: string | null;
  frystFakturamottagareId?: string | null;
  uppdateradAv?: "skapande" | "propagering";
  /** Förberäknat objekt (bulk-paths) — hoppar över objekt-fetch. */
  preloadedObject?: ObjectRowForPaket | null;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Åtkomst hämtas ur Åtkomst-metadatat (Etapp 5): Åtkomsttyp/Åtkomstkod/
 * Nyckelnummer/Åtkomstinfo, arvs-medvetet (närmast-vinner). Best-effort:
 * läsfel får aldrig fälla paketbygget — åtkomst blir då null.
 */
async function buildAtkomst(
  tenantId: string,
  objectId: string,
): Promise<UppgiftspaketAtkomst | null> {
  try {
    const { getObjectAtkomstFields } = await import("../metadata-queries");
    const f = await getObjectAtkomstFields(objectId, tenantId);
    const typ = f.typ;
    const portkod = f.portkod;
    const nyckelnummer = f.nyckelnummer;
    const info = f.info;
    if (
      portkod == null &&
      nyckelnummer == null &&
      info == null &&
      (typ == null || typ === "open")
    ) {
      return null;
    }
    return { typ, portkod, nyckelnummer, info };
  } catch (err) {
    console.error(`[uppgiftspaket] åtkomst kunde inte läsas för objekt ${objectId}:`, err);
    return null;
  }
}

/** Bygger ett komplett uppgiftspaket. Kastar ALDRIG för saknat objekt — position blir null. */
export async function buildUppgiftspaket(args: BuildUppgiftspaketArgs): Promise<Uppgiftspaket> {
  const uppdateradAv = args.uppdateradAv ?? "skapande";
  let position: Uppgiftspaket["position"] = null;
  let atkomst: UppgiftspaketAtkomst | null = null;

  if (args.objectId) {
    const obj = args.preloadedObject ?? (await getObjectRowForPaket(args.tenantId, args.objectId));
    if (obj) {
      const geografi = await resolveUppgiftGeografi(args.tenantId, args.objectId, obj);
      if (geografi) position = { primar: geografi.primar, sekundar: geografi.sekundar };
      atkomst = await buildAtkomst(args.tenantId, args.objectId);
    }
  }

  const start = toIso(args.tidsfonsterStart);
  const slut = toIso(args.tidsfonsterSlut);

  return {
    version: UPPGIFTSPAKET_VERSION,
    uppdateradVid: new Date().toISOString(),
    uppdateradAv,
    position,
    tidsfonster: start != null || slut != null ? { start, slut } : null,
    antal: args.antal ?? null,
    artikel:
      args.utforandekod != null || args.tidskod != null
        ? { utforandekod: args.utforandekod ?? null, tidskod: args.tidskod ?? null }
        : null,
    kund:
      args.kundId != null || args.frystFakturamottagareId != null
        ? {
            kundId: args.kundId ?? null,
            frystFakturamottagareId: args.frystFakturamottagareId ?? null,
          }
        : null,
    atkomst,
  };
}

// ============================================================================
// PROPAGERING — full paketuppdatering för öppna/framtida uppgifter
// ----------------------------------------------------------------------------
// Körs från metadata-change-jobs när objektmetadata ändrats (enskild redigering
// OCH massimport — batch-writern enqueue:ar samma jobb). Träffar BÅDA lagren
// (assignments + work_orders, uppgiftskontrakt v1) och uppdaterar dessutom de
// tekniska spegelkolumnerna present-value-only. Frysta uppgifter röres aldrig.
// ============================================================================

// Larmtröskel för subtree-storlek: propageringen trunkeras ALDRIG (kravet är
// att ALLA öppna/framtida uppgifter uppdateras), men vid ändringar mycket högt
// upp i hierarkin loggas en tydlig varning så kostnaden syns i drift.
const SUBTREE_WARN_THRESHOLD = 10_000;

/** Utökar ändrade objekt-id:n med HELA deras subträd (primär hierarki, uttömmande). */
async function expandToSubtree(tenantId: string, objectIds: string[]): Promise<string[]> {
  if (objectIds.length === 0) return [];
  const result = await db.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM objects
      WHERE tenant_id = ${tenantId} AND id IN (${sql.join(objectIds.map((id) => sql`${id}`), sql`, `)})
      UNION ALL
      SELECT o.id FROM objects o
      JOIN subtree s ON o.parent_id = s.id
      WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL
    )
    SELECT DISTINCT id FROM subtree
  `);
  const ids = (result.rows as Array<{ id: string }>).map((r) => r.id);
  if (ids.length >= SUBTREE_WARN_THRESHOLD) {
    console.warn(
      `[uppgiftspaket] STORT subträd vid propagering: ${ids.length} objekt (tenant ${tenantId}, ${objectIds.length} ändrade rötter) — full propagering körs ändå, men överväg riktade ändringar.`,
    );
  }
  return ids;
}

export interface PropagateResult {
  workOrdersUpdated: number;
  assignmentsUpdated: number;
}

// Chunka IN-listor så att mycket stora subträd aldrig spränger PG:s
// parametergräns — varje chunk hämtas separat, INGEN rad utelämnas.
const IN_CHUNK_SIZE = 5_000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Full paketuppdatering för alla ÖPPNA/FRAMTIDA uppgifter kopplade till de
 * ändrade objekten (inkl. deras subträd — barn ärver metadata). Bevarar
 * caller-satta paketfält (tidsfönster/antal/artikel/kund uppdateras från radens
 * egna kolumner, inte nollas) och uppdaterar position/åtkomst från objektet.
 */
export async function propagateUppgiftspaket(
  tenantId: string,
  changedObjectIds: string[],
): Promise<PropagateResult> {
  const objectIds = await expandToSubtree(tenantId, changedObjectIds);
  if (objectIds.length === 0) return { workOrdersUpdated: 0, assignmentsUpdated: 0 };

  let workOrdersUpdated = 0;
  let assignmentsUpdated = 0;

  // Cache per objekt: geografi + åtkomst beräknas EN gång oavsett antal uppgifter.
  const paketBaseByObject = new Map<
    string,
    { position: Uppgiftspaket["position"]; atkomst: UppgiftspaketAtkomst | null }
  >();
  const getPaketBase = async (objectId: string) => {
    let base = paketBaseByObject.get(objectId);
    if (!base) {
      const obj = await getObjectRowForPaket(tenantId, objectId);
      if (obj) {
        const geografi = await resolveUppgiftGeografi(tenantId, objectId, obj);
        base = {
          position: geografi ? { primar: geografi.primar, sekundar: geografi.sekundar } : null,
          atkomst: await buildAtkomst(tenantId, objectId),
        };
      } else {
        base = { position: null, atkomst: null };
      }
      paketBaseByObject.set(objectId, base);
    }
    return base;
  };

  // ---- work_orders (materialiserat lager) ----
  const woRows = (
    await Promise.all(
      chunk(objectIds, IN_CHUNK_SIZE).map((ids) =>
        db
          .select({
            id: workOrders.id,
            objectId: workOrders.objectId,
            orderStatus: workOrders.orderStatus,
            executionStatus: workOrders.executionStatus,
            invoiceQueueState: workOrders.invoiceQueueState,
            impossibleReason: workOrders.impossibleReason,
            plannedWindowStart: workOrders.plannedWindowStart,
            plannedWindowEnd: workOrders.plannedWindowEnd,
            desiredDeliveryStart: workOrders.desiredDeliveryStart,
            desiredDeliveryEnd: workOrders.desiredDeliveryEnd,
            customerId: workOrders.customerId,
            frozenInvoiceRecipientId: workOrders.frozenInvoiceRecipientId,
            frozenQuantity: workOrders.frozenQuantity,
            executionCode: workOrders.executionCode,
            frozenTimeCode: workOrders.frozenTimeCode,
            taskLatitude: workOrders.taskLatitude,
            taskLongitude: workOrders.taskLongitude,
            uppgiftspaket: workOrders.uppgiftspaket,
          })
          .from(workOrders)
          .where(and(
            eq(workOrders.tenantId, tenantId),
            inArray(workOrders.objectId, ids),
            isNull(workOrders.deletedAt),
          )),
      ),
    )
  ).flat();

  for (const wo of woRows) {
    const status = deriveUppgiftStatus({
      orderStatus: wo.orderStatus as any,
      executionStatus: wo.executionStatus as any,
      invoiceQueueState: (wo.invoiceQueueState as InvoiceQueueState | null) ?? null,
      impossible: wo.impossibleReason != null,
    });
    if (isUppgiftFrozen(status)) continue;
    if (!wo.objectId) continue;

    try {
      const base = await getPaketBase(wo.objectId);
      const prev = wo.uppgiftspaket as Uppgiftspaket | null;
      const start = toIso(wo.plannedWindowStart ?? wo.desiredDeliveryStart);
      const slut = toIso(wo.plannedWindowEnd ?? wo.desiredDeliveryEnd);
      const paket: Uppgiftspaket = {
        version: UPPGIFTSPAKET_VERSION,
        uppdateradVid: new Date().toISOString(),
        uppdateradAv: "propagering",
        position: base.position,
        tidsfonster:
          start != null || slut != null ? { start, slut } : (prev?.tidsfonster ?? null),
        antal: wo.frozenQuantity ?? prev?.antal ?? null,
        artikel:
          wo.executionCode != null || wo.frozenTimeCode != null
            ? { utforandekod: wo.executionCode ?? null, tidskod: wo.frozenTimeCode ?? null }
            : (prev?.artikel ?? null),
        kund: {
          kundId: wo.customerId ?? prev?.kund?.kundId ?? null,
          frystFakturamottagareId:
            wo.frozenInvoiceRecipientId ?? prev?.kund?.frystFakturamottagareId ?? null,
        },
        atkomst: base.atkomst,
      };

      // Spegelsynk (present-value-only): ruttbar koordinat → taskLatitude/Longitude.
      // Saknad/ej ruttbar position nollar ALDRIG befintliga speglar.
      const mirror: Partial<typeof workOrders.$inferInsert> = {};
      const p = base.position?.primar;
      if (p?.ruttbar && p.latitude != null && p.longitude != null) {
        if (wo.taskLatitude !== p.latitude) mirror.taskLatitude = p.latitude;
        if (wo.taskLongitude !== p.longitude) mirror.taskLongitude = p.longitude;
      }

      await db
        .update(workOrders)
        .set({ uppgiftspaket: paket, ...mirror })
        .where(and(eq(workOrders.id, wo.id), eq(workOrders.tenantId, tenantId)));
      workOrdersUpdated++;
    } catch (err) {
      console.error(`[uppgiftspaket] propagation misslyckades för WO ${wo.id}:`, err);
    }
  }

  // ---- assignments (pre-materialiserat lager) ----
  const aRows = (
    await Promise.all(
      chunk(objectIds, IN_CHUNK_SIZE).map((ids) =>
        db
          .select({
            id: assignments.id,
            objectId: assignments.objectId,
            status: assignments.status,
            plannedWindowStart: assignments.plannedWindowStart,
            plannedWindowEnd: assignments.plannedWindowEnd,
            customerId: assignments.customerId,
            quantity: assignments.quantity,
            executionCode: assignments.executionCode,
            frozenTimeCode: assignments.frozenTimeCode,
            address: assignments.address,
            latitude: assignments.latitude,
            longitude: assignments.longitude,
            uppgiftspaket: assignments.uppgiftspaket,
          })
          .from(assignments)
          .where(and(
            eq(assignments.tenantId, tenantId),
            inArray(assignments.objectId, ids),
            isNull(assignments.deletedAt),
          )),
      ),
    )
  ).flat();

  for (const a of aRows) {
    // assignments.status bär exekveringsstatus-värden + "cancelled" (som
    // deriveUppgiftStatus inte känner till på exec-axeln) — gata båda.
    if (a.status === "cancelled") continue;
    const status = deriveUppgiftStatus({ executionStatus: a.status as any, materialized: false });
    if (isUppgiftFrozen(status)) continue;

    try {
      const base = await getPaketBase(a.objectId);
      const prev = a.uppgiftspaket as Uppgiftspaket | null;
      const start = toIso(a.plannedWindowStart);
      const slut = toIso(a.plannedWindowEnd);
      const paket: Uppgiftspaket = {
        version: UPPGIFTSPAKET_VERSION,
        uppdateradVid: new Date().toISOString(),
        uppdateradAv: "propagering",
        position: base.position,
        tidsfonster:
          start != null || slut != null ? { start, slut } : (prev?.tidsfonster ?? null),
        antal: a.quantity ?? prev?.antal ?? null,
        artikel:
          a.executionCode != null || a.frozenTimeCode != null
            ? { utforandekod: a.executionCode ?? null, tidskod: a.frozenTimeCode ?? null }
            : (prev?.artikel ?? null),
        kund: {
          kundId: a.customerId ?? prev?.kund?.kundId ?? null,
          frystFakturamottagareId: prev?.kund?.frystFakturamottagareId ?? null,
        },
        atkomst: base.atkomst,
      };

      // Spegelsynk (present-value-only): adress + ruttbar koordinat.
      const mirror: Partial<typeof assignments.$inferInsert> = {};
      const p = base.position?.primar;
      if (p?.adress != null && p.adress !== a.address) mirror.address = p.adress;
      if (p?.ruttbar && p.latitude != null && p.longitude != null) {
        if (a.latitude !== p.latitude) mirror.latitude = p.latitude;
        if (a.longitude !== p.longitude) mirror.longitude = p.longitude;
      }

      await db
        .update(assignments)
        .set({ uppgiftspaket: paket, ...mirror })
        .where(and(eq(assignments.id, a.id), eq(assignments.tenantId, tenantId)));
      assignmentsUpdated++;
    } catch (err) {
      console.error(`[uppgiftspaket] propagation misslyckades för assignment ${a.id}:`, err);
    }
  }

  return { workOrdersUpdated, assignmentsUpdated };
}

// ============================================================================
// Task #1218 (Etapp 6): GDPR-ANONYMISERING — scrubba paket-kopior
// ----------------------------------------------------------------------------
// Anonymisering måste träffa ALLA kopior — även FRYSTA uppgifter som
// propageringen medvetet aldrig rör. Denna scrub nollar de berörda paket-
// delarna (åtkomst och/eller position) + tekniska spegelkolumner på SAMTLIGA
// uppgifter (öppna + frysta) i objektets subträd. Öppna uppgifter byggs
// därefter om av caller via propagateUppgiftspaket (från den nu anonymiserade
// källan) — frysta behåller det scrubbade paketet.
// ============================================================================

export interface ScrubUppgiftspaketOpts {
  /** Nolla paketets åtkomst-del (portkod/nyckelnummer/info/typ). */
  atkomst?: boolean;
  /** Nolla paketets position-del + spegelkolumner (address/lat/lng). */
  position?: boolean;
}

export async function scrubUppgiftspaketForAnonymization(
  tenantId: string,
  objectId: string,
  opts: ScrubUppgiftspaketOpts,
): Promise<void> {
  if (!opts.atkomst && !opts.position) return;
  const objectIds = await expandToSubtree(tenantId, [objectId]);
  if (objectIds.length === 0) return;

  for (const ids of chunk(objectIds, IN_CHUNK_SIZE)) {
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);

    // work_orders: paket-jsonb + taskLatitude/taskLongitude-speglar.
    await db.execute(sql`
      UPDATE work_orders SET
        uppgiftspaket = CASE WHEN uppgiftspaket IS NULL THEN NULL ELSE
          ${opts.atkomst ? sql`jsonb_set(` : sql``}${opts.position ? sql`jsonb_set(` : sql``}uppgiftspaket${opts.position ? sql`, '{position}', 'null'::jsonb)` : sql``}${opts.atkomst ? sql`, '{atkomst}', 'null'::jsonb)` : sql``}
        END
        ${opts.position ? sql`, task_latitude = NULL, task_longitude = NULL` : sql``}
      WHERE tenant_id = ${tenantId} AND object_id IN (${idList})
    `);

    // assignments: paket-jsonb + address/latitude/longitude-speglar.
    await db.execute(sql`
      UPDATE assignments SET
        uppgiftspaket = CASE WHEN uppgiftspaket IS NULL THEN NULL ELSE
          ${opts.atkomst ? sql`jsonb_set(` : sql``}${opts.position ? sql`jsonb_set(` : sql``}uppgiftspaket${opts.position ? sql`, '{position}', 'null'::jsonb)` : sql``}${opts.atkomst ? sql`, '{atkomst}', 'null'::jsonb)` : sql``}
        END
        ${opts.position ? sql`, address = NULL, latitude = NULL, longitude = NULL` : sql``}
      WHERE tenant_id = ${tenantId} AND object_id IN (${idList})
    `);
  }
}
