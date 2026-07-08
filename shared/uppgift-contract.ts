/**
 * UPPGIFTSKONTRAKT v1 — LÅST DATAKONTRAKT (P2 · "Lås modellen")
 * ============================================================
 * Detta är den ENDA importbara källan för P3/P4/P5 gällande:
 *   #5  gemensam uppgiftsmodell (logisk "Uppgift"),
 *   #8  informationspaketets datakontrakt (fält → källa → hämtningssätt),
 *   #19 status som ETT fält (kanonisk, härledd).
 *
 * ADDITIVT. Denna modul ändrar inga anropare, inga kolumner, inga migrationer.
 * Den beskriver kontraktet; den tvingar inte (ingen runtime-validering byggs i P2).
 * Full motivering + öppna frågor: docs/adr-uppgiftskontrakt-v1.md
 *
 * Expand-contract: den fysiska verkligheten (assignments + work_orders med
 * fragmenterad status) ändras INTE i P2 — kontraktet är en logisk vy ovanpå den,
 * på samma sätt som objektsidan (P1) var presentation-only.
 */

import type { OrderStatus, ExecutionStatus } from "./schema";

/* ============================================================
 * #19 · STATUS SOM ETT FÄLT
 * ============================================================
 * Grundmodellen: EN status uppgiften intar — ingen livscykel, inget mellanläge.
 * Kanonisk, ordnad, användarvänd. Härleds från de fysiska kolumnerna via
 * deriveUppgiftStatus() (fysisk konsolidering av kolumnerna är deferrad).
 *
 * Produktägarbeslut (2026-07-07):
 *  - "skapad" är bara skapandeögonblicket; normala uppgifter hamnar DIREKT i
 *    masterplanering. "skapad" är durabelt ENDAST för uppskjutna avrop/abonnemang
 *    som väntar på sin trigger (ännu ej materialiserade till work_orders).
 *  - "fakturakontroll" = fakturagranskning/kö (utförd väntar på fakturering),
 *    kopplas till fakturakön (held/pending/consolidated) — INTE en separat fysisk
 *    besiktning. Exec-status "inspected" faller in här.
 *  - "avbruten" ÄR en egen kanonisk status (vid sidan av "omöjlig att utföra").
 */
export const UPPGIFT_STATUSES = [
  "skapad",
  "i_masterplanering",
  "planerad",
  "pa_vag",
  "pa_plats",
  "utford",
  "fakturakontroll",
  "fakturerad",
  "omojlig_att_utfora",
  "avbruten",
] as const;
export type UppgiftStatus = (typeof UPPGIFT_STATUSES)[number];

export const UPPGIFT_STATUS_LABELS: Record<UppgiftStatus, string> = {
  skapad: "Skapad",
  i_masterplanering: "I masterplanering",
  planerad: "Planerad",
  pa_vag: "På väg",
  pa_plats: "På plats",
  utford: "Utförd",
  fakturakontroll: "Fakturakontroll",
  fakturerad: "Fakturerad",
  omojlig_att_utfora: "Omöjlig att utföra",
  avbruten: "Avbruten",
};

/**
 * Fakturaköns lägen (work_orders.invoiceQueueState). DB-kolumnen är otypad text;
 * detta är den kontrakterade värdemängden. Callers som läser rå text castar hit.
 */
export const INVOICE_QUEUE_STATES = ["pending", "held", "consolidated", "exported"] as const;
export type InvoiceQueueState = (typeof INVOICE_QUEUE_STATES)[number];

/**
 * Ingång till statushärledningen. Speglar de fysiska kolumnerna på BÅDA lagren:
 *  - work_orders (materialiserat): orderStatus, executionStatus, invoiceQueueState.
 *  - assignments (pre-materialiserat): executionStatus + awaitingTrigger/materialized.
 * "planerad" har interna dellägen (planerad_resurs/planerad_las resp. planned_fine)
 * som ALLA mappar till det ENA värdet "planerad".
 */
export interface UppgiftStatusInput {
  /** work_orders.orderStatus (ORDER_STATUSES) — null före materialisering. */
  orderStatus?: OrderStatus | null;
  /** work_orders/assignments.executionStatus (EXECUTION_STATUSES). */
  executionStatus?: ExecutionStatus | null;
  /** work_orders.invoiceQueueState (otypad DB-text; castas till unionen). */
  invoiceQueueState?: InvoiceQueueState | null;
  /** work_orders.impossibleReason satt (redundant med orderStatus="omojlig"). */
  impossible?: boolean;
  /** Uppskjutet avrop/abonnemang som väntar på sin trigger (ännu ej släppt). */
  awaitingTrigger?: boolean;
  /** Projicerad till work_orders än? Default true. false = ren assignment-rad. */
  materialized?: boolean;
}

/**
 * Ren funktion: fragmenterade fysiska statusar → ETT kanoniskt värde.
 * Precedens uppifrån och ned (terminala/mest framskridna lägen vinner).
 * Detta är kontraktet — P3 flyttar hit; ingen annan plats får definiera mappningen.
 */
export function deriveUppgiftStatus(input: UppgiftStatusInput): UppgiftStatus {
  const { orderStatus, executionStatus, invoiceQueueState } = input;
  const materialized = input.materialized ?? true;
  const inInvoiceQueue =
    invoiceQueueState === "pending" ||
    invoiceQueueState === "held" ||
    invoiceQueueState === "consolidated";

  if (orderStatus === "avbruten") return "avbruten";
  if (orderStatus === "omojlig" || input.impossible === true) return "omojlig_att_utfora";
  if (
    orderStatus === "fakturerad" ||
    executionStatus === "invoiced" ||
    invoiceQueueState === "exported"
  ) {
    return "fakturerad";
  }
  if (
    executionStatus === "inspected" ||
    ((executionStatus === "completed" || orderStatus === "utford") && inInvoiceQueue)
  ) {
    return "fakturakontroll";
  }
  if (executionStatus === "completed" || orderStatus === "utford") return "utford";
  if (executionStatus === "on_site") return "pa_plats";
  if (executionStatus === "on_way") return "pa_vag";
  if (
    executionStatus === "planned_fine" ||
    orderStatus === "planerad_resurs" ||
    orderStatus === "planerad_las"
  ) {
    return "planerad";
  }
  // Uppskjutet/ej materialiserat = durabelt "skapad". Allt annat (nyskapat,
  // not_planned, planned_rough, planerad_pre) är per produktägarbeslut redan
  // "i masterplanering".
  if (input.awaitingTrigger === true || materialized === false) return "skapad";
  return "i_masterplanering";
}

/* ============================================================
 * #8 · INFORMATIONSPAKETETS DATAKONTRAKT
 * ============================================================
 * Två axlar (grundmodell §3), håll dem åtskilda:
 *   KÄLLA (kalla)          = varifrån fältet härstammar (kortets rubrik).
 *   HÄMTNINGSSÄTT (hamtning) = HUR fältet fylls (badgen D/M/S/SYS).
 * Ett fält kan ha flera hämtningssätt (t.ex. "Kund · betalare" = D + M).
 *
 * OBS uppföljning: P1:s client/src/lib/metadata-kalla.tsx använder D/M/S/SYS som
 * KÄLL-etiketter (D=artikel, M=objekt, S=orderkoncept, SYS=system) och blandar
 * därmed ihop de två axlarna. Detta kontrakt använder grundmodellens kanoniska
 * betydelse nedan. Ometikettering av P1-UI = liten separat uppföljning (ej P2).
 */
export type UppgiftKalla = "artikel" | "orderkoncept" | "objekt" | "system";

export type Hamtningssatt = "D" | "M" | "S" | "SYS";

export const HAMTNINGSSATT: Record<Hamtningssatt, string> = {
  D: "Ren data (direkt fältvärde)",
  M: "Metadata-styrt (via metadata-katalogen)",
  S: "Hämtas från sidoregister",
  SYS: "Systemsatt (motorer/automatik)",
};

export const KALLA_LABELS: Record<UppgiftKalla, string> = {
  artikel: "Artikel",
  orderkoncept: "Orderkoncept",
  objekt: "Objekt (metadata)",
  system: "Systemsatt (motorer & system)",
};

/** Var kontraktsfältet fysiskt bor idag (nuvarande backing). */
export type FaltStorage = "column" | "live-compute" | "engine-output" | "sidoregister";

/**
 * Status per fält mot 94-fälts-avstämningen (se docs/informationspaket-94-falt-avstamning.md).
 * Utelämnad status tolkas som "finns" (modellerat och i drift).
 */
export type FaltStatus = "finns" | "harleds" | "delvis" | "saknas" | "motor_kvar";

export interface InformationspaketFalt {
  /** Fältnamn enligt grundmodell §3. */
  falt: string;
  /** KÄLLA-axeln. */
  kalla: UppgiftKalla;
  /** HÄMTNINGSSÄTT-axeln (kan vara flera). */
  hamtning: Hamtningssatt[];
  /** Hur fältet lagras/beräknas idag. */
  storage: FaltStorage;
  /** Nuvarande backing (kolumn/tjänst) — best-effort karta till dagens kod. */
  backing: string;
  /** Status mot 94-fälts-avstämningen. Utelämnad = "finns". */
  status?: FaltStatus;
}

/**
 * Det låsta fältkontraktet. Grundregel (grundmodell §3): ALLA datafält på
 * artikeln OCH orderkonceptet ska återfinnas här, plus objekt-metadata och de
 * systemsatta motor-fälten. P4 (motorerna) fyller SYS-fälten; P3 kopplar källorna.
 */
export const INFORMATIONSPAKET_FALT: InformationspaketFalt[] = [
  // ---- Från artikeln ----
  { falt: "Artikelnr · namn · beskrivning", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles (via articleId)" },
  { falt: "Pris · kostnader · påslag · fast pris", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles pris/kostnad/påslag (öre); fixed_price_basis" },
  { falt: "Produktionstid · restid · ställtid", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles tidsfält (min)" },
  { falt: "Antalsläge (styck/formel/matchar fält)", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles.quantityMode → computeArticleQuantity" },
  { falt: "Får ändras av utförare · dölj antal", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles operatorCanUpdateQuantity/hideQuantityInApp" },
  { falt: "Dokument · arbetsbeskrivning", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles dokument/arbetsbeskrivning" },
  { falt: "Visa/lämna metadatafält", kalla: "artikel", hamtning: ["M"], storage: "live-compute", backing: "article associationRules → getArticleMetadataForObject (katalog-namn)" },
  { falt: "Fasttagningslogik (hakar på metadata =)", kalla: "artikel", hamtning: ["M"], storage: "live-compute", backing: "matchesFilter (shared/condition-matching.ts)" },
  { falt: "Ikon · enhet · debiteringsmodell", kalla: "artikel", hamtning: ["S"], storage: "sidoregister", backing: "icon-register (RegistryIcon); enhet; debiteringsmodell" },
  { falt: "Artikeltyp · artikelområde", kalla: "artikel", hamtning: ["S"], storage: "sidoregister", backing: "artikeltyp/-område-register" },
  { falt: "Utförandekod · tidskod", kalla: "artikel", hamtning: ["S"], storage: "sidoregister", backing: "execution-code-register; tidskod (restidsmotor)" },
  { falt: "Lagerplats · leverantör", kalla: "artikel", hamtning: ["S"], storage: "sidoregister", backing: "lagerplats/leverantör-register" },
  { falt: "Strukturartiklar (BOM)", kalla: "artikel", hamtning: ["S"], storage: "sidoregister", backing: "article_components (self-ref förbjuden)" },

  // ---- Från orderkonceptet ----
  { falt: "Kund · betalare", kalla: "orderkoncept", hamtning: ["D", "M"], storage: "column", backing: "assignments.customerId (concept-customer-resolver); object_payers" },
  { falt: "Antal (grundvärde · korsbefruktning)", kalla: "orderkoncept", hamtning: ["D", "M"], storage: "live-compute", backing: "order_concepts grundantal; crossPollinationField; computeArticleQuantity" },
  { falt: "Önskad leveranstid · tidsfönster", kalla: "orderkoncept", hamtning: ["D", "M"], storage: "column", backing: "assignments.plannedWindowStart/End; frozenTimeRules (N tidsfönster)" },
  { falt: "Leveransrestriktioner (mjuk/hård)", kalla: "orderkoncept", hamtning: ["D"], storage: "column", backing: "frozenTimeRules hard/soft (frozen-time-rules)" },
  { falt: "Prismodell (löpande/fast) · fast pris-bas", kalla: "orderkoncept", hamtning: ["D"], storage: "column", backing: "order_concepts invoiceModel; fixed_price_basis (per_object/per_task/per_concept)" },
  { falt: "Faktureringssätt (efterhand/schema/abonn.)", kalla: "orderkoncept", hamtning: ["D"], storage: "column", backing: "order_concepts fakturametod (getOrderConceptMethod)" },
  { falt: "Fakturakonsolidering (jobb/vecka/mån/avd)", kalla: "orderkoncept", hamtning: ["D"], storage: "column", backing: "order_concepts invoiceConsolidation → billingSegmentKey" },
  { falt: "Fakturalås · fakturabroms", kalla: "orderkoncept", hamtning: ["D"], storage: "column", backing: "invoiceQueueState (held/invoiceHeldUntil). ÖPPEN: lås-enhet vid 1 koncept→flera fakturor" },
  { falt: "Vår ref · Er ref · beteckning", kalla: "orderkoncept", hamtning: ["D", "M"], storage: "column", backing: "order_concepts ourReference/yourReference/beteckning" },
  { falt: "Fakturareferens per rad", kalla: "orderkoncept", hamtning: ["D", "M"], storage: "column", backing: "per-rad fakturareferens → billingSegmentKey" },
  { falt: "Prislista", kalla: "orderkoncept", hamtning: ["S"], storage: "sidoregister", backing: "price_lists (priceListRoutes)" },
  { falt: "Abonnemang (avgift · frekvens · bindning)", kalla: "orderkoncept", hamtning: ["D"], storage: "column", backing: "order_concepts abonnemang; computeConceptSubscriptionFee (motor 5 deferrad)" },

  // ---- Från objektet (metadata) ----
  { falt: "Påhakat objekt (namn · nummer)", kalla: "objekt", hamtning: ["D"], storage: "column", backing: "objectId → objects.objectNumber/name" },
  { falt: "Objektets adress · koordinat", kalla: "objekt", hamtning: ["D"], storage: "column", backing: "snapshot assignments.address/latitude/longitude (object-location entré-koord)" },
  { falt: "Objektets metadatafält (kärltyp, kod …)", kalla: "objekt", hamtning: ["M"], storage: "live-compute", backing: "metadata_katalog/metadata_varden (server/metadata-queries.ts)" },
  { falt: "Antal enl. objekt-metadata", kalla: "objekt", hamtning: ["M"], storage: "live-compute", backing: "matches_field → getArticleMetadataForObject" },
  { falt: "Ärvda metadatafält (från förälder)", kalla: "objekt", hamtning: ["M"], storage: "live-compute", backing: "metadata-arv från primär förälder (object_parents)" },
  { falt: "Felanmälan · betyg (kundportal)", kalla: "objekt", hamtning: ["M"], storage: "live-compute", backing: "public_issue_reports; technician_ratings → system-generated-metadata" },

  // ---- Systemsatt (motorer & system) ----
  { falt: "Skapad av (skaparens löpnr)", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "skapar-referens (orderkoncept/snabborder/felanmälan/rating)" },
  { falt: "Hur skapad (klartext)", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "skapande-metod (klartext)" },
  { falt: "Vår referens (löpnr → källa)", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "server-myntad referens, spårbar till skaparen" },
  { falt: "Uppgiftstyp (produktion/resa/ställ/egen)", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "task_types register; normalizeTaskType; executionCode styr tidskod" },
  { falt: "Ruttbar position (geografisk motor)", kalla: "system", hamtning: ["SYS"], storage: "engine-output", backing: "motor 1 (object-location.ts) — pinpoint entré-koord" },
  { falt: "Planerad · verklig leveranstid (tidsmotor)", kalla: "system", hamtning: ["SYS"], storage: "engine-output", backing: "motor 2 → slot_times; plannedWindowStart/End" },
  { falt: "Klump-/indexkod (klumpmotor)", kalla: "system", hamtning: ["SYS"], storage: "engine-output", backing: "motor 3 → slot_times (metadata.kind=clump)" },
  { falt: "Fakturagruppering (fakturamotor)", kalla: "system", hamtning: ["SYS"], storage: "engine-output", backing: "motor 4 → billingSegmentKey (kanonisk nyckel)" },
  { falt: "Abonnemangskoppling (abonn.motor)", kalla: "system", hamtning: ["SYS"], storage: "engine-output", backing: "motor 5 (deferrad); computeConceptSubscriptionFee" },
  { falt: "Beroende-ordning (beroendemotor)", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "motor 6 → parentAssignmentId; task_dependencies" },
  { falt: "System- + affärsstatus", kalla: "system", hamtning: ["SYS"], storage: "live-compute", backing: "deriveUppgiftStatus() över orderStatus+executionStatus+invoiceQueueState" },

  // ---- Kompletterande atomära fält från 94-fälts-avstämningen ----
  // (docs/informationspaket-94-falt-avstamning.md). Additivt: gör kontraktet
  // 1:1 mot CSV:ns 94 fält så inget döljs i en hopbuntad rubrikrad. Status
  // anger var något ännu inte är helt modellerat.
  { falt: "Artikelstatus (aktiv)", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles status (isActiveArticleStatus)", status: "finns" },
  { falt: "Begränsning antal per adress/objekt", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles.maxPerAddress + limitationScope (adress/objekt/kund); enforced i workOrderRoutes", status: "finns" },
  { falt: "Begränsningstyp (en gång per objekt/adress/kund)", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles.limitationType (one_per_object/address/customer); enforced i workOrderRoutes", status: "finns" },
  { falt: "Lagernivåer (säkerhetslager · beställningspunkt · minsta order)", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles.safetyStock/reorderPoint/minOrderQuantity", status: "finns" },
  { falt: "Leverantörs artnr · leveranstid", kalla: "artikel", hamtning: ["D", "S"], storage: "column", backing: "articles leverantörs-artnr/leveranstid; leverantörsregister", status: "finns" },
  { falt: "Ej förbrukas (icke-förbrukningsartikel)", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles.notConsumed → reconcileWorkOrderLineStock hoppar över lagerdrag", status: "finns" },
  { falt: "Visade metadatafält får uppdateras av utförare (per fält)", kalla: "artikel", hamtning: ["M"], storage: "live-compute", backing: "showMetadataFields[].canUpdate; enforced server-side (mobile/misc metadata-update, isFieldUpdatable)", status: "finns" },
  { falt: "Krav: metadata måste lämnas för att slutföra", kalla: "artikel", hamtning: ["M"], storage: "live-compute", backing: "obligatorisk-metadata completion-gate (completion-gate dual status)", status: "finns" },
  { falt: "Visas på faktura · faktureras till kund (artikelflaggor)", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles.showOnInvoice/invoiceToCustomer → Fortnox-radbyggaren (skip/pris 0); ej_fakturerbar kvar som per-tillfälle-override", status: "finns" },
  { falt: "Ej beroende av objektets geografiska position", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles.isGeoDependent (inverterad UI-flagga)", status: "finns" },
  { falt: "Kan användas själv som strukturartikel", kalla: "artikel", hamtning: ["D"], storage: "column", backing: "articles struktur-flagga", status: "finns" },

  { falt: "Offset (tid · typ samtidigt/före/efter)", kalla: "orderkoncept", hamtning: ["SYS"], storage: "column", backing: "assignments offset_minutes + offset-typ (beroendemotor)", status: "finns" },
  { falt: "Automatisk repetering (start/stopp/säsong)", kalla: "orderkoncept", hamtning: ["D"], storage: "column", backing: "recurrence/recurrenceInterval/-Unit + flexibel frekvens (säsong)", status: "finns" },
  { falt: "Inpekat objekt (topp av gren)", kalla: "orderkoncept", hamtning: ["D"], storage: "column", backing: "target_object_ids (subträd primär parent)", status: "finns" },

  { falt: "Objektets höjd Pos Z (3D)", kalla: "objekt", hamtning: ["D"], storage: "column", backing: "— ingen höjd/Z-koordinat modellerad", status: "saknas" },
  { falt: "Objektets yta eller sträcka", kalla: "objekt", hamtning: ["D"], storage: "column", backing: "— ej modellerat", status: "saknas" },
  { falt: "Lantmäteri (fastighetsbeteckning · -ägare per plats)", kalla: "objekt", hamtning: ["M"], storage: "live-compute", backing: "metadata FASBET (fastighetsbeteckning); fastighetsägare per plats ej bekräftad", status: "delvis" },
  { falt: "What3words (sekundär platsreferens)", kalla: "objekt", hamtning: ["M"], storage: "live-compute", backing: "metadata What3words-fält (object-system-metadata)", status: "finns" },

  { falt: "Taget · fakturerbart antal", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "orderrad takenQuantity/returnedQuantity vs quantity (fakturerat)", status: "finns" },
  { falt: "Hur objektet hittades/hakats på (klartext)", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "härledning via koncept-resolver; per-uppgift-klartext ej komplett", status: "delvis" },
  { falt: "Hur kunden valts/styrts", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "HARDCODED/FROM_METADATA (order-concept-customer-resolution)", status: "finns" },
  { falt: "Tidslogg (begärd · planerad · verklig leveranstid)", kalla: "system", hamtning: ["SYS"], storage: "engine-output", backing: "task_events tidslogg + slot_times", status: "finns" },
  { falt: "Affärsstatus (offert→ordererkännande→följesedel→faktura)", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "dokumenttyp-map (delivery_note m.fl.); full kedja ej komplett", status: "delvis" },
  { falt: "Maskering av pris på följesedel", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "pris-maskering konceptuellt; explicit flagga ej bekräftad", status: "delvis" },
  { falt: "Tidstyp som grund för löneunderlag", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "tidskod → payroll-export (härleds ur uppgiftens tidstyp)", status: "harleds" },
  { falt: "Utförare/team tilldelad", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "assignments/work_orders tilldelning (team/fordon)", status: "finns" },
  { falt: "Kostnadsställe · projekt", kalla: "system", hamtning: ["SYS"], storage: "column", backing: "costCenter/projectCode (fortnox-code-derivation)", status: "finns" },
  { falt: "Överbokad (som egen uppgiftsstatus)", kalla: "system", hamtning: ["SYS"], storage: "live-compute", backing: "— saknas i deriveUppgiftStatus(); planerad åtgärd D", status: "saknas" },
  { falt: "Plockuppgift: val artikelnr (plocka-från-lager vs beställ-hem)", kalla: "system", hamtning: ["SYS"], storage: "engine-output", backing: "lagermodell känner saldo; förgrenings-logik ej byggd", status: "motor_kvar" },
];

/* ============================================================
 * #5 · GEMENSAM UPPGIFTSMODELL (logisk vy)
 * ============================================================
 * EN logisk "Uppgift" backas idag av TVÅ fysiska tabeller (expand-contract):
 *   - assignments  (pre-materialiserat: orderkoncept-expansion, avrop/abonnemang)
 *   - work_orders  (materialiserat: synligt för fält/planner + fakturering)
 * De korreleras idag löst (objectId + customerId + orderConceptId), UTAN FK.
 *
 * KONTRAKT (implementeras i P3, INTE P2):
 *  a) uppgiftId = work_orders.id efter materialisering, annars assignments.id.
 *  b) Nullable spårbarhets-FK work_orders.assignmentId införs (expand-contract)
 *     så materialiserade uppgifter kan spåras tillbaka till sin assignment.
 *  c) ALLA fyra skapare MÅSTE landa i registret. Per produktägarbeslut skapar
 *     felanmälan/rating en uppgift DIREKT vid händelsen (ingen manuell grind).
 *  d) VARJE uppgift bär en artikel (grundmodell: "en uppgift = en artikel").
 *     Admin-/påminnelseuppgifter ("ring kund") backas av admin-artiklar
 *     (taskCategory="admin"); produktion/resa/ställ/egentid = uppgiftstyper.
 */
export type UppgiftKallaSkapare =
  | "orderkoncept"
  | "snabborder"
  | "felanmalan"
  | "rating"
  | "metadatabevakning";

export interface UppgiftRef {
  /** work_orders.id efter materialisering, annars assignments.id. */
  uppgiftId: string;
  /** Vilket fysiskt lager id:t pekar på just nu. */
  lager: "work_order" | "assignment";
  /** Vilken av de fyra+1 skaparna som gav upphov till uppgiften. */
  skapare: UppgiftKallaSkapare;
}
