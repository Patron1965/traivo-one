# ADR — Affärsstatus-kedjan (Offert → Ordererkännande → Följesedel → Leveransbekräftelse → Faktura)

**Status:** Förslag — UTREDNING, kräver PO-beslut (Mats) innan bygge.
**Datum:** 2026-07-08.
**Fält:** Informationspaketets fält 90 ("Affärsstatus"), idag klassat **Delvis**
(`docs/informationspaket-94-falt-avstamning.md` rad 90/166).
**Föregångare:** `docs/adr-orderkoncept-v3.md` (fakturanivåer, samlingsfakturor),
`docs/adr-uppgiftskontrakt-v1.md` (status som ETT fält).
**Scope:** Rent designdokument. Ingen kod, inga migrationer — bygget är en separat task.

---

## 1. Kontext & problem

Informationspaketets fält 90 beskriver en **affärsstatus-kedja** för en uppgift:

> Offert → Ordererkännande → Följesedel (ev. Fraktsedel) → Leveransbekräftelse → Faktura

Detta är en *dokument-/handels*-livscykel, skild från *var i utförandet* uppgiften är
(planerad/på väg/utförd) och från *var i faktureringen* den ligger. Idag är kedjan bara
delvis representerad:

- **Dokumenttyper finns som koncept-konfiguration, inte som instanser.**
  `DOCUMENT_TYPES = ["order_confirmation", "delivery_note", "invoice"]`
  (`shared/schema.ts`) och `document_configurations` (per `order_concept_id`) säger
  *vilka dokument ett koncept ska producera och hur* (mottagare, kanaler, prisvisning) —
  men det finns **ingen tabell som registrerar att ett specifikt dokument faktiskt
  skapades/skickades för en specifik order**.
- **Faktura-delen spåras separat** via fakturaköns-status
  (`work_orders.invoiceQueueState` ∈ `pending/held/consolidated/exported`) och
  `customer_invoices` (med `pdf_url`, `fortnoxInvoiceId`). Fakturan är alltså det enda
  ledet i kedjan som har en verklig instans-representation — och den ligger i en helt
  annan modell än de tre `DOCUMENT_TYPES`.
- **Offert och Leveransbekräftelse saknas helt.** Ingen dokumenttyp, ingen instans,
  inget flöde. "Offert" hanteras idag pragmatiskt via simuleringsscenarier
  (`simulation_scenarios` / `work_orders.isSimulated`) som är What-If-planering, inte ett
  affärsdokument med mottagare och godkännande. "Leveransbekräftelse" (kundens kvittens,
  ev. signatur/BankID) finns bara som fältkvittens i Traivo Go, inte som ett spårat
  affärsdokument.

### 1.1 De tre befintliga statusaxlarna (får INTE utökas till en fjärde)

| Axel | Kolumn | Värden | Betydelse |
|---|---|---|---|
| Livscykel (Modus) | `work_orders.orderStatus` | `skapad, planerad_pre, planerad_resurs, planerad_las, utford, fakturerad, omojlig, avbruten` | Var i planerings-/orderlivscykeln |
| Utförande | `work_orders.executionStatus` | `not_planned … on_way, on_site, completed, inspected, invoiced` | Var i fältutförandet |
| Fakturakö | `work_orders.invoiceQueueState` | `pending, held, consolidated, exported` | Var i faktureringen |

Dessa tre kollapsas redan idag till **ETT** användarvänt värde via
`deriveUppgiftStatus()` (`shared/uppgift-contract.ts`) — det låsta kontraktet
"status som ETT fält" (#19). Att införa en **`business_status`-kolumn** på
`work_orders` skulle skapa en **fjärde konkurrerande statusaxel** som måste hållas
synkad med de tre andra och med `deriveUppgiftStatus()` — precis det kontraktet förbjuder.

**Varför affärsstatus ändå inte är samma sak som de tre axlarna:** de tre axlarna beskriver
*en enskild uppgifts* interna tillstånd. Affärsstatus beskriver *vilka handelsdokument som
har utväxlats med kunden*. Ett ordererkännande kan finnas innan uppgiften ens är planerad;
en följesedel skapas när uppgiften utförs; en leveransbekräftelse kommer *tillbaka* från
kunden. Kedjan är alltså en egen dimension — men den ska **härledas ur fakta (vilka
dokument finns), inte lagras som ett eget redigerbart status­ord**.

---

## 2. Beslut (rekommendation) — affärsstatus som HÄRLEDD dokument-instans-vy

### 2.1 Inför INGEN `business_status`-kolumn

Affärsstatus modelleras **inte** som ett fält någon sätter. Den **härleds** ur vilka
dokument-instanser som existerar för ordern (analogt med hur `deriveUppgiftStatus()`
härleder ur de fysiska kolumnerna). Detta bevarar "status som ETT fält"-kontraktet och
undviker synk-buggar mellan konkurrerande statusar.

### 2.2 Utöka dokumenttyperna med Offert + Leveransbekräftelse (+ ev. Fraktsedel)

```
DOCUMENT_TYPES (nuvarande):  order_confirmation, delivery_note, invoice
DOCUMENT_TYPES (föreslaget): quote, order_confirmation, waybill?, delivery_note,
                             delivery_confirmation, invoice
```

- `quote` (Offert) — icke-bindande erbjudande. Kan bygga på simulering men blir ett
  eget affärsdokument med mottagare/kanal/giltighetstid.
- `delivery_confirmation` (Leveransbekräftelse) — kundens kvittens på mottagen leverans
  (ev. signatur/BankID). Ett *inkommande* dokument (kunden bekräftar), till skillnad från
  de övriga som skickas ut.
- `waybill` (Fraktsedel) — nämns i fält 90 som ett möjligt led; föreslås som **valfri**
  dokumenttyp (många tenants använder bara följesedel). Tas med i enum men aktiveras per
  koncept.

Expand-contract: enum är redan otypad `text` i DB (`documentType text`), så nya värden
kräver ingen kolumn-migration — bara utökad `DOCUMENT_TYPES`-konstant + label-map och att
`document_configurations` tillåter de nya typerna.

### 2.3 Ny tabell: `document_instances` (per order, inte per koncept)

Kärnan i förslaget. En rad = "detta dokument av denna typ existerar för denna order".

```
document_instances
  id, tenant_id
  work_order_id        -- FK work_orders (uppgiften/ordern dokumentet gäller)
  document_type        -- quote | order_confirmation | waybill | delivery_note
                       --   | delivery_confirmation | invoice
  status               -- created | sent | accepted | rejected | superseded
                       --   (litet, dokument-lokalt tillstånd — INTE affärsstatus)
  issued_at            -- när dokumentet skapades
  sent_at, sent_channel -- distribution (email/portal/sms/print)
  acknowledged_at      -- för delivery_confirmation: när kunden kvitterade
  document_number      -- ev. löpnummer (server-myntat, jfr SO-NNN/OBJ-NNN)
  pdf_url              -- genererad fil (om någon)
  external_ref         -- t.ex. fortnox_invoice_id för invoice-instansen
  metadata             -- snapshot (prisvisning, mottagare) från document_configurations
  created_at
  index (tenant_id, work_order_id)
  index (tenant_id, document_type)
```

**Fakturan integreras utan dubbellagring:** en `invoice`-instans är en tunn pekare till
den befintliga `customer_invoices`-raden (via `external_ref`/`fortnoxInvoiceId`) — inte en
kopia av fakturadatan. Affärsstatus "Faktura" härleds då konsekvent ur *samma* fakta som
fakturaköns-status redan bygger på. (Alternativt: härled `invoice`-ledet direkt ur
`invoiceQueueState=exported` / `customer_invoices` utan en instans-rad; se §4 fråga F2.)

### 2.4 Härledningen: `deriveBusinessStatus()`

En ren funktion, i samma anda som `deriveUppgiftStatus()`, i
`shared/uppgift-contract.ts` (eller intilliggande modul):

```
deriveBusinessStatus(order): {
  reached: DocumentType[]          // vilka led som passerats (dokument finns)
  current: DocumentType | null     // längst framskridna led
  pending: DocumentType[]          // konfigurerade men ännu ej skapade led
}
```

Regler:
- `current` = det mest framskridna ledet i den kanoniska ordningen
  (`quote < order_confirmation < waybill < delivery_note < delivery_confirmation < invoice`)
  där en instans finns.
- `pending` härleds mot `document_configurations` (vad konceptet är konfigurerat att
  producera) minus vad som redan finns.
- Fakturaledet räknas som nått när `invoiceQueueState=exported` **eller** en
  `invoice`-instans finns — enda källan förblir faktureringsmodellen.

Ingen ny status skrivs någonstans; vyn beräknas vid läsning (live-compute), precis som
objekt-360 och koncept-data (`planner-concept-data-live-compute`).

### 2.5 Presentation

Affärsstatus visas som en **kedje-/stegindikator** (breadcrumb med bockade led) på
uppgiftens/orderns detaljvy och i informationspaket-kortet — separat från den ENA
uppgiftsstatusen. Den är read-only (härledd). Exakt UI är utanför denna ADR:s scope;
förslaget låser bara datamodellen och härledningen.

---

## 3. Migrations- / expand-contract-konsekvenser

| Steg | Åtgärd | Säkerhet |
|---|---|---|
| E1 | Utöka `DOCUMENT_TYPES` med `quote`, `delivery_confirmation` (+ ev. `waybill`) + labels. | Additivt; DB-kolumnen är redan fri text. |
| E2 | Skapa `document_instances` (ny tabell, nullable-rik). Idempotent migration + post-merge replay-lista (jfr `schema-drift-replay`). | Ny tabell, inga writes till hot path. |
| E3 | Backfill befintliga fakturor → `invoice`-instanser (eller härled utan rad, F2). | Read-only backfill. |
| E4 | `deriveBusinessStatus()` + live-compute-endpoint. Ingen skrivning. | Ren funktion, testbar. |
| E5 | Skrivvägar: koncept-expansion/fältflöde skapar instanser vid rätt tillfälle (t.ex. följesedel vid utförd, ordererkännande vid orderläggning). | Additivt, styrs av `document_configurations.enabled`. |

Inga befintliga kolumner ändras; `deriveUppgiftStatus()` och de tre statusaxlarna är
orörda. Prod-schema når prod endast via Publish (jfr `prod-schema-publish-propagation`).

---

## 4. Öppna frågor (kräver PO-svar)

- **F1 — Fraktsedel:** ska `waybill` med i v1, eller räcker `delivery_note`? (Rek: ta med
  i enum men default av.)
- **F2 — Fakturaledet:** egen `invoice`-instansrad (enhetlig modell) eller härled direkt
  ur `invoiceQueueState`/`customer_invoices` utan rad? (Rek: härled utan rad i v1 — mindre
  dubbellagring; instans kan införas senare.)
- **F3 — Offert vs simulering:** ska `quote` byggas ovanpå `simulation_scenarios`, eller
  vara ett fristående dokument? (Rek: fristående dokument som *kan* referera en simulering.)
- **F4 — Leveransbekräftelse-signatur:** räcker enkel kvittens (`acknowledged_at`), eller
  krävs BankID/signatur redan i v1? (Rek: kvittens i v1, signatur som uppföljning.)

---

## 5. Beslutsunderlag — ja/nej + scope för bygget

**Frågan till Mats:** Ska vi modellera affärsstatus-kedjan som **härledda
dokument-instanser** (ny `document_instances`-tabell + utökade dokumenttyper +
`deriveBusinessStatus()`), och **inte** som en ny `business_status`-kolumn?

**JA innebär ett efterföljande bygge med scope:**
1. Utöka `DOCUMENT_TYPES` (`quote`, `delivery_confirmation`, ev. `waybill`) + labels.
2. Ny tabell `document_instances` (idempotent migration + post-merge replay).
3. `deriveBusinessStatus()` (ren funktion) + live-compute-endpoint + tester.
4. Skrivvägar som skapar instanser i orderkoncept-expansion och fältflödet, styrt av
   `document_configurations`.
5. Presentation: kedje-indikator på uppgifts-/orderdetalj + informationspaket-kort.
6. Uppdatera fält 90 i `informationspaket-94-falt-avstamning.md` från **Delvis** → **Finns**.

**NEJ / alternativ riktning** (om PO vill annat):
- (A) Minimalt: bara lägga till `quote`/`delivery_confirmation` som
  `document_configurations`-typer utan instans-tabell — då finns *konfigurationen* men
  fortfarande ingen spårning av "var i kedjan" (löser inte grundproblemet).
- (B) `business_status`-kolumn — **avrådes uttryckligen**: bryter "status som ETT
  fält"-kontraktet och inför en fjärde synk-pliktig statusaxel.

**Rekommendation:** JA enligt §2 + §5, med F1–F4 besvarade (rek-svaren i §4). Detta är den
minst riskfyllda vägen som faktiskt gör "var i affärskedjan" synligt, återanvänder
befintlig faktura-/dokumentmodell och respekterar det låsta status-kontraktet.
