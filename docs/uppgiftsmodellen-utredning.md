# Utredning: uppgiftsmodellen ("uppgiften som informationspaket")

> **Typ:** Utredning / spec (Task #1079). Ingen kod ändras av detta dokument.
> **Syfte:** Slå fast vad en *uppgift* bär för information och hur den lever genom
> systemet, samt **bevisa att varje del redan motsvaras av ett befintligt system**
> — så att Spår 4 (Sök på kopplade uppgifter) och Spår 6 (Systemgenererad
> metadata) bygger *ovanpå* det som finns och **inte** ett parallellt spår.
> **Källor:** ADR v3 (`docs/adr-orderkoncept-v3.md`), `shared/schema.ts`,
> `server/services/*`, `server/routes/orderConceptRoutes.ts`,
> `server/routes/fortnoxRoutes.ts`.

---

## 1. Vad är en uppgift?

En **uppgift** är det informationspaket ett *orderkoncept* genererar per objekt vid
expansion. För objekt-bundna fältuppgifter materialiseras den som en rad i tabellen
`assignments` (`shared/schema.ts`, `export const assignments`) och bär allt som krävs
för att planera, utföra och fakturera ett enskilt arbetsmoment.

Den vanliga vägen till en uppgift är att ett koncept **expanderas** mot de
objekt/grenar konceptet pekar in (steg 4 i koncept-wizarden). Det finns dock
undantag som måste tas med: *administrativa*/objektslösa konceptartiklar
(`taskCategory != 'field'`) expanderas i samma flöde direkt till `work_orders`
(inte `assignments`), abonnemangskoncept skapar inga assignments alls, och
uppgifter kan även skapas manuellt via `POST /api/assignments`. Det är denna
expansionskedja utredningen kartlägger.

### Informationspaketet — del för del

| Del | Vad den innehåller | Bärs av (fält / tabell) |
|---|---|---|
| **Artikel** | Vad som ska göras/levereras (tjänst eller vara) | `assignment_articles.articleId`; uppgiftskategori cachas på `work_orders.taskCategory` (från `order_concept_articles.taskCategory`) — **ej** på `assignments` |
| **Antal** | Hur många (t.ex. antal kärl) — ofta metadatastyrt | `assignment_articles.quantity`, `assignments.quantity` (härlett via `quantityMode`) |
| **Pris / kostnad** | Intäkt och självkostnad × antal, ev. fryst | `assignments.cachedValue` / `cachedCost`, `assignment_articles` (pris per enhet), frysta priser på WO |
| **Plats** | Var arbetet sker — objektets adress *eller* artikelns lagerplats | `assignments.address/latitude/longitude`, `logisticsRole` + `parentAssignmentId` |
| **Tidsfönster** | Ett huvud-/önskefönster + ev. flera hårda/mjuka regler | `assignments.plannedWindowStart/End`, `frozenTimeRules` (`FrozenTimeRulePackage`) |
| **Kund** | Order-/faktureringskund (låst på koncept eller via metadata) | `assignments.customerId` (snapshotad vid expansion) |
| **Fakturareferens** | Referens/märkning som följer med till fakturan | objektets/kundens refs via `invoice-line-enrichment.ts` |
| **Fakturarad-metadata** *(framtida)* | Extra metadata som ska synas/styra på **fakturaraden** | **Finns inte ännu** — se §5 |

---

## 2. Livscykel

```
Orderkoncept
   │  (expansion mot inpekade objekt/grenar — steg 4)
   ▼
Uppgift (assignments-rad)   ← informationspaketet fryses här
   │  artikel, antal, pris/kostnad, plats, frozenTimeRules, kund snapshotas
   ▼
Grovplanering (tidsmotor)   ← motorn skriver slot_times (klump/fristående)
   │
   ▼
Finplanering                ← resurs/team, lås av tid
   │
   ▼
Utförd (fält)               ← status → completed/utford, ev. foton/kvittens
   │
   ▼
Fakturakö (work_orders)     ← invoiceQueueState: pending/held/consolidated
   │  samlingsfaktura grupperar held-WO per recipient
   ▼
Fortnox                     ← export med frysta priser + fryst fakturamottagare
```

---

## 3. Mappning mot befintliga system

Varje del nedan **finns redan**. Inget nytt spår behöver byggas för dem.

### 3.1 Artikel + antal
- **Koncept→uppgift-expansionen** läser `order_concept_articles` och skapar
  `assignments`-rader (samt `assignment_articles`) för objekt-bundna fältartiklar.
  Exekverings-entrypunkt: `server/routes/fortnoxRoutes.ts`
  (`POST /api/order-concepts/:id/execute` → `generateScheduleAssignments` →
  `storage.createAssignment`). `server/routes/orderConceptRoutes.ts` håller
  wizard-/list-/validerings-API:erna (bl.a.
  `GET /api/order-concepts/:id/assignments` som listar genererade uppgifter, och
  `POST /api/assignments` för manuell skapelse). Administrativa konceptartiklar
  (`taskCategory != 'field'`) expanderas i samma execute-flöde direkt till
  `work_orders`.
- **Antalet** härleds av den centraliserade kvantitetslogiken:
  `server/article-quantity.ts` (`computeArticleQuantity`) +
  `server/article-quantity-resolver.ts` (`resolveEffectiveArticleQuantity`),
  som tolkar `quantityMode` (`per_styck` / `matches_field` / formel / fast) och
  slår upp objektets metadatavärde via katalog-**namn** (svenska metadata-systemet).
- *Konsekvens för Spår 6:* "antal från metadata" är redan kopplat — systemgenererad
  metadata ska *visa* detta, inte återimplementera kvantitetsberäkningen.

### 3.2 Pris / kostnad
- Ordervärde beräknas via `shared/order-concept-value.ts`; faktureringsmetod väljs
  via `shared/order-concept-method.ts` (fast pris-bas `per_object/per_task/per_concept`,
  abonnemang, à-pris).
- Abonnemangsavgift: `server/services/order-concept-subscription.ts`
  (`computeConceptSubscriptionFee`) — **enda källan** för avgiftsfördelning.
- Frysning: priser fryses på work order vid `freeze`; Fortnox-export använder
  `frozenUnitPrice` annars `line.resolvedPrice`.

### 3.3 Plats (objektadress **eller** artikelns lagerplats)
- Objektets plats/ruttbarhet bor i `server/services/object-location.ts`
  (entrékoordinat = pinpoint + ruttbar fallback). Uppgiften cachar `address/lat/long`.
- **Vara med lagerplats** delas vid expansion i en **hämta-uppgift** (på lagerplats)
  + en **leverera-uppgift** (på objektet) via `assignments.logisticsRole`
  (`pickup`/`deliver`) länkade med `parentAssignmentId` (hämta före leverera).
  Lagerplats finns på artikeln (`articles` — `warehouseCost`, lagerplats-fält).
- *Bekräftelse:* "plats = objektadress eller lagerplats" är redan modellerat —
  ingen ny platsmodell behövs.

### 3.4 Tidsfönster (ett huvudfönster + hårda/mjuka regler)
- Hela det viktade tidsregel-paketet fryses per uppgift vid expansion till
  `assignments.frozenTimeRules` (`FrozenTimeRulePackage`,
  `shared/delivery-restrictions.ts`).
- Bygge/tolkning: `server/services/time-rule-package.ts`
  (`buildConceptTimeRulePackagesByObject`, `softPriorityDelta`).
  **Hårda** regler hanteras av tids-/geomotorn som kandidat-in/uteslutning
  (krävd/blockerande) och faller tillbaka på de befintliga `time_windows`-
  mekanismerna — de översätts alltså **inte** rakt av till Geoapify-`time_windows`
  i `server/vrp-constraints.ts` (som uttryckligen *inte* processar hårda regler).
  **Mjuka** regler injiceras som prioritetsdelta (`softPriorityDelta`).
  Önske-/huvudfönster finns även som `plannedWindowStart/End` + leveranspreferenser.

### 3.5 Kund (låst på koncept eller via Fortnox-kundnummer i metadata)
- Kund resolvas av `server/services/concept-customer-resolver.ts`
  (`resolveConceptCustomerForObject`) i två lägen:
  - **HARDCODED** — konceptets fasta kund.
  - **FROM_METADATA** — kund härleds per objekt ur ett metadatafält (svensk katalog),
    matchat mot kundnummer eller namn (tvetydigt namn = fel som blockerar).
- Resultatet **snapshotas** på `assignments.customerId` vid expansion. Detta är
  *order-/faktureringskund*, **inte** objektägarskap (`object_payers`,
  `server/services/object-customer.ts`) — i linje med ADR v3 (objekt-neutralitet).
- Fakturamottagare (3 nivåer central/area/local) resolvas via
  `storage.resolveInvoiceRecipient` och fryses på WO vid freeze.

### 3.6 Fakturareferens
- Referenser (objekt/kund) resolvas i `server/services/invoice-line-enrichment.ts`
  (`resolveObjectInvoiceRefs`, `buildInvoiceLineBaseText`, `formatEnrichedDescription`).
- Radtext byggs via **delade** helpers så att enskild och konsoliderad faktura får
  identisk text; kundreferens ligger på fakturahuvudet (`YourReference`), inte per rad.

### 3.7 Grovplanering, fakturakö & Fortnox
- **Grovplanering (tidsmotor):** motorn skriver `slot_times`; läsmodellen monteras i
  `server/services/engine-results.ts` (`getEngineResults` — fristående uppgifter +
  klumpuppgifter). Beslut stämplas tillbaka på `slot_times`.
- **Fakturakö / samlingsfaktura:** `server/services/invoice-consolidation.ts`
  (`markWorkOrderReadyForInvoice`, `resolveConsolidationPolicy`, `computePeriodEnd`,
  `runConsolidationForTenant`). Tillstånd bärs av `work_orders.invoiceQueueState`
  (`pending`/`held`/`consolidated`/`exported`). Segmentnyckel för gruppering:
  `billingSegmentKey` (`server/services/invoice-flow-segmentation.ts`).
- **Fortnox:** `server/fortnox-client.ts` (export med frysta priser + fryst
  fakturamottagare; refuserar `held` WO).

---

## 4. Öppen fråga: `assignments` ⇄ `work_orders`

Uppgiften som ett koncept genererar är en **`assignments`-rad** (bär plats, antal,
`frozenTimeRules`, snapshotad kund, beroende-/logistik-flaggor). Men
**fakturakö-tillståndet** (`invoiceQueueState`, `invoiceHeldUntil`) och flera
order-/Fortnox-fält ligger på **`work_orders`**. Logistik-varianter spänner dessutom
över båda tabellerna (hämta+leverera-par i `assignments` via `parentAssignmentId`;
leverera+retur-par i `work_orders` via `task_dependencies`).

**Detta är en befintlig dualitet, inte ett nytt system.** Viktigt: det finns
**ingen explicit främmande nyckel** mellan `assignments` och `work_orders` i schemat
— de korrelerar i dag via gemensamma dimensioner (objekt, koncept, kund, tid), inte
via en FK. Inför Spår 4 (Sök på kopplade uppgifter) bör vi därför medvetet välja källa:
- "Kopplade uppgifter på ett objekt" ⇒ läs `assignments` (det är där koncept-genererade
  fältuppgifter och `objectId` bor; jfr `GET /api/order-concepts/:id/assignments`).
- Ska sökningen även visa faktura-/livscykel-status måste en explicit korrelations-/
  join-strategi mot `work_orders` definieras först (ingen FK att luta sig mot).

Ingen kod ändras här — punkten lyfts så att Spår 4 designas mot rätt källa.

---

## 5. Den enda genuint nya delen: metadata på fakturarad

Sökning i `server/`, `shared/` och `client/` visar **inget** system för
rad-nivå-metadata på faktura (inga fält/typer som `invoiceRowMetadata`,
`invoice_row_metadata` el. likn.). Dagens fakturarad (`work_order_lines`: artikel/beskrivning/antal/pris/kostnad/notes)
bär en **text** (byggd av `buildInvoiceLineBaseText`/`formatEnrichedDescription`) plus
pris/antal — men ingen strukturerad, frågbar metadata kopplad till själva raden.

**Slutsats:** "metadata på fakturarad" är den **enda** delen av informationspaketet
som saknar ett befintligt system. Den är **framtida arbete** och uttryckligen
*out of scope* för denna utredning och för Spår 4/6. Den bör få ett eget beslut
(ADR-tillägg) när den prioriteras, med frågor som:
- Var lagras rad-metadatan (på `assignment_articles`/WO-rad eller egen tabell)?
- Fryses den vid freeze på samma sätt som pris/tidsregler?
- Exporteras den till Fortnox (radkommentar/dimension) eller är den enbart intern?

---

## 6. Slutsats

Alla delar av uppgiftens informationspaket — artikel, antal, pris/kostnad, plats,
tidsfönster, kund och fakturareferens — **motsvaras redan av befintliga, namngivna
system**. Spår 4 och Spår 6 ska därför **återanvända** dessa (koncept-expansion,
kvantitetslogik, fryst tidsregel-paket, kund-resolver, faktura-enrichment,
fakturakö) och **inte** bygga ett parallellt uppgiftsspår. Den enda genuint nya
biten — **metadata på fakturarad** — skjuts till framtida arbete med eget beslut.
