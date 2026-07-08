# Informationspaketet — avstämning av alla 94 fält

**Datum:** 2026-07-08
**Källa:** `attached_assets/Upgiftslogic_*.csv` (fältraden = 94 unika kolumner)
**Syfte:** Bevisa att *inget* av de 94 informationsfälten slarvas bort. Varje fält får
en rad med källa, hur det fylls och var det finns i systemet idag — plus en ärlig status.

## Varför det tidigare såg ut som färre fält

Det låsta datakontraktet (`shared/uppgift-contract.ts`) **buntar ihop** flera atomära
CSV-fält till en rubrikrad (t.ex. "Pris · kostnader · påslag · fast pris" = fyra
CSV-fält). Kontraktet hade ~42 rubrikrader; CSV:n har 94 atomära fält. Ingenting var
avsiktligt borttaget — men sammanslagningen är just där ett fält kan tappas tyst.
Denna avstämning är 1:1 mot de 94 fälten, och kontraktet är nu kompletterat så att
även de tidigare osynliga fälten (inkl. luckorna) är explicit representerade.

## Sammanfattning

| Status | Antal | Betydelse |
| --- | --- | --- |
| **Finns** | 80 | Modellerat och i drift idag |
| **Härleds** | 1 | Beräknas/härleds från annan källa |
| **Delvis** | 11 | Finns delvis — behöver komplettering |
| **Saknas** | 2 | Ej modellerat — äkta lucka |
| **Summa** | **94** | |

Plus **1 status-lucka**: "Överbokad" saknas som egen uppgiftsstatus (del av fält 88 — åtgärd D).
Plus **1 hängande tråd (motor)**: systemskapad plockuppgift saknar logik för att välja
artikelnummer/uppgiftstyp *plocka-från-lager vs beställ-hem* (del av fält 3 — motor kvar).

> **Not om räkningen:** "Överbokad" ryms i CSV-fält 88 (uppgiftsstatus), som i 94-tabellen
> räknas som **Delvis** — därför förblir summan 2 Saknas. I det låsta kontraktet
> (`shared/uppgift-contract.ts`) listas "Överbokad" däremot som en *egen* atomär rad med
> `status: "saknas"`, eftersom själva statusvärdet ännu inte finns i `deriveUppgiftStatus()`.
> Samma lucka, två vyer: hopbuntad i rapporten, atomär i kontraktet.

Beteckningar för "Hur det fylls": **D** = ren data · **M** = metadata-katalog · **S** = sidoregister · **SYS** = systemsatt (motor/automatik).

---

## A. Artikeln — grunddata & styrning (fält 1–49)

| # | Fält (CSV) | Källa | Hur | Var i systemet idag | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Art nr | Artikel | D | `articles.articleNumber` | Finns |
| 2 | Unikt uppgiftsnummer | System | SYS | server-myntat WO/assignment-id + ordernummer | Finns |
| 3 | Uppgiftskälla (hur skapad) | System | SYS | skapande-metod/skapare-referens | Finns¹ |
| 4 | Namn | Artikel | D | `articles.name` | Finns |
| 5 | Extern beskrivning (kund) | Artikel | D | `articles` extern beskrivning | Finns |
| 6 | Intern beskrivning | Artikel | D | `articles` intern beskrivning | Finns |
| 7 | Uppgiftsdokument (fil-länk) | Artikel | D | `articles` dokument | Finns |
| 8 | Leverantörs artnr | Artikel | S | leverantörsregister | Finns |
| 9 | Icon | Artikel | S | ikonregister (RegistryIcon) | Finns |
| 10 | Status artikel | Artikel | D | `articles` status (`isActiveArticleStatus`) | Finns |
| 11 | Enhet | Artikel | S | enhetsregister | Finns |
| 12 | Listpris | Artikel | D | `articles` listpris (öre) | Finns |
| 13 | Sammanräknad kostnad (inköp/standard/material/frakt/lager/intern/påslag) | Artikel | D | `articles` kostnads-/påslagsfält | Finns |
| 14 | Debiteringsmodell (st/timme/fast) | Artikel | S | debiteringsmodell | Finns |
| 15 | Produktionstid | Artikel | D | `articles` produktionstid | Finns |
| 16 | Antal orderkoncept | Orderkoncept | D/M | `order_concepts` grundantal → `computeArticleQuantity` | Finns |
| 17 | Antal objekt-metadata | Objekt | M | `matches_field` → `getArticleMetadataForObject` | Finns |
| 18 | Antal får uppdateras av utförare | Artikel | D | `articles.operatorCanUpdateQuantity` | Finns |
| 19 | Begränsningstyp (en gång per objekt/adress/kund) | Artikel | D | `limitationType` (typ 1) + `limitationScope`/`maxPerAddress` (numeriskt tak); enforced i `workOrderRoutes` | Finns |
| 20 | Begränsning antal per adress/objekt | Artikel | D | `articles.maxPerAddress` | Finns |
| 21 | Dolt antal | Artikel | D | `articles.hideQuantityInApp` | Finns |
| 22 | Taget antal | System | SYS | orderrad `takenQuantity` | Finns |
| 23 | Fakturerbart antal | System | SYS | `quantity` (fakturerat) vs `takenQuantity`/`returnedQuantity` | Finns |
| 24 | Fastpris från orderkoncept | Orderkoncept | D | `fixed_price_basis` | Finns |
| 25 | Artikel ingår i abonnemang | Orderkoncept | D | `order_concepts` abonnemang | Finns |
| 26 | Ska visas på faktura | Artikel | D | `articles.showOnInvoice` → Fortnox-radbyggaren utelämnar raden | Finns |
| 27 | Ska faktureras till kund | Artikel | D | `articles.invoiceToCustomer` → Fortnox-radbyggaren pris 0; `ej_fakturerbar` kvar som per-tillfälle-override | Finns |
| 28 | Artikeltyp (tjänst/vara/avvikelse/avisering) | Artikel | S | artikeltyp-register | Finns |
| 29 | Artikelområde (RBK/Deklaration/Reservdel/Förbrukning) | Artikel | S | artikelområde-register | Finns |
| 30 | Utförandekod | Artikel | S | execution-code-register | Finns |
| 31 | Skapar tidstyp (Produktion/Ställtid/Resa/Nattvila/Rast…) | Artikel | S | tidskod-register | Finns |
| 32 | Lagerplats | Artikel | S | lagerplats-register | Finns |
| 33 | Ej förbrukas | Artikel | D | `articles.notConsumed` → `reconcileWorkOrderLineStock` hoppar över lagerdrag | Finns |
| 34 | Standardleverantör | Artikel | S | leverantörsregister | Finns |
| 35 | Leveranstid (leverantör) | Artikel | D | `articles` leveranstid | Finns |
| 36 | Säkerhetslager | Artikel | D | `articles.safetyStock` | Finns |
| 37 | Beställningspunkt | Artikel | D | `articles.reorderPoint` | Finns |
| 38 | Ekonomisk beställningskvantitet / minsta order | Artikel | D | `articles.minOrderQuantity` | Finns |
| 39 | Offsettid | Orderkoncept | SYS | assignments `offset_minutes` | Finns |
| 40 | Typ offset (samtidigt/före/efter) | Orderkoncept | SYS | offset-typ | Finns |
| 41 | Visa metadata (valda fält) | Artikel | M | `associationRules` → `getArticleMetadataForObject` | Finns |
| 42 | Visade fält får uppdateras av utförare | Artikel | M | `showMetadataFields[].canUpdate` (per fält); enforced server-side (`mobile/misc` metadata-update, `isFieldUpdatable`) | Finns |
| 43 | Lämna metadata | Artikel | M | lämna-metadata (`getArticleMetadataForObject`) | Finns |
| 44 | Krav: metadata måste lämnas för att slutföra | Artikel | M | obligatorisk-metadata completion-gate | Finns |
| 45 | Kan användas som strukturartikel | Artikel | D | `articles` struktur-flagga | Finns |
| 46 | Strukturartikel (BOM) | Artikel | S | `article_components` (self-ref förbjuden) | Finns |
| 47 | Fasthakningslogik (metadatavillkor) | Artikel | M | `matchesFilter` (condition-matching) | Finns |
| 48 | Ej beroende av objektets geografiska position | Artikel | D | `articles.isGeoDependent` (inverterad UI-flagga) | Finns |
| 49 | Beroende artikel | Orderkoncept | SYS | `task_dependencies`/`parentAssignmentId` (beroendemotor) | Finns |

¹ Systemskapad **plockuppgift**-gren (plocka-från-lager vs beställ-hem) saknar ännu val-logik — se "Hängande trådar".

## B. Skapande, objekt- & kundkoppling (fält 50–57)

| # | Fält (CSV) | Källa | Hur | Var i systemet idag | Status |
| --- | --- | --- | --- | --- | --- |
| 50 | Inpekat objekt (topp av gren) | Orderkoncept | D | `target_object_ids` (subträd primär parent) | Finns |
| 51 | Skapat av (orderkoncept/order/funktion) | System | SYS | skapar-referens | Finns |
| 52 | Hur uppgiften skapats (källa) | System | SYS | skapande-metod klartext | Finns |
| 53 | Påhakat objekt | Objekt | D | `objectId` → `objects` | Finns |
| 54 | Hur objektet hittas/hakats på | System | SYS | härledning via koncept-resolver; "hur"-klartext per uppgift | **Delvis** |
| 55 | Kund | Orderkoncept | D/M | `assignments.customerId` (concept-customer-resolver); `object_payers` | Finns |
| 56 | Hur kunden valts/styrts | System | SYS | HARDCODED/FROM_METADATA (customer-resolution) | Finns |
| 57 | Från orderkoncept | System | SYS | `orderConceptId`-koppling | Finns |

## C. Tid & leveranstid (fält 58–61)

| # | Fält (CSV) | Källa | Hur | Var i systemet idag | Status |
| --- | --- | --- | --- | --- | --- |
| 58 | Övriga tidsfönster (hård/mjuk) | Orderkoncept | D | `frozenTimeRules` (N fönster) | Finns |
| 59 | Automatisk repetering (start/stopp/säsong) | Orderkoncept | D | `recurrence` + flexibel frekvens (säsong) | Finns |
| 60 | Tidslogg (begärd/planerad/verklig leveranstid) | System | SYS | `task_events` tidslogg + `slot_times` | Finns |
| 61 | Dynamiskt bästa tid (tidsmotor) | System | SYS | motor 2 → `slot_times` | Finns |

## D. Geografi — från metadata + motorer (fält 62–69)

| # | Fält (CSV) | Källa | Hur | Var i systemet idag | Status |
| --- | --- | --- | --- | --- | --- |
| 62 | Adress | Objekt | D | snapshot `assignments.address` (object-location) | Finns |
| 63 | Pos XY 2D | Objekt | D | latitude/longitude (entré-koord) | Finns |
| 64 | Pos Z 3D | Objekt | D | — ingen höjd/Z-koordinat | **Saknas** |
| 65 | Yta eller sträcka | Objekt | D | — ej modellerat | **Saknas** |
| 66 | Lantmäteri (fastighetsbeteckning/-ägare per plats) | Objekt | M | Fastighetsbeteckning (metadata FASBET) finns; fastighetsägare per plats ej bekräftad | **Delvis** |
| 67 | What3words | Objekt | M | metadata What3words-fält | Finns |
| 68 | Motor 1 sammanställd beräknad plats | System | SYS | motor 1 (object-location, ruttbar entré-koord) | Finns |
| 69 | Ihopklumpat "Stop" (motor 3) | System | SYS | motor 3 → `slot_times` (metadata.kind=clump) | Finns |

## E. Fakturahuvud & referenser (fält 70–78)

| # | Fält (CSV) | Källa | Hur | Var i systemet idag | Status |
| --- | --- | --- | --- | --- | --- |
| 70 | 1, Kund (fakturahuvud) | Orderkoncept | D | fakturamottagare (`invoice_recipients`/`customers`) | Finns |
| 71 | Vårt referensnr = orderkoncept # | Orderkoncept | D | `ourReference` (koncept-nr) | Finns |
| 72 | Vår referens "manuellt" (användaren) | Orderkoncept | D | `ourReference` (manuell) | Finns |
| 73 | 2, Er referens (kan vara metadata) | Orderkoncept | D/M | `yourReference` | Finns |
| 74 | Metadatafält er referens | Orderkoncept | M | `yourReference` från metadata | Finns |
| 75 | 3, Ert referensnummer (kan vara metadata) | Orderkoncept | D/M | ert referensnummer | Finns |
| 76 | Metadatafält ert referensnummer | Orderkoncept | M | ert referensnr från metadata | Finns |
| 77 | Info orderrad | Orderkoncept | D/M | per-rad fakturareferens (`invoiceRowReferenceFields`) | Finns |
| 78 | Metadatafält (orderrad) | Orderkoncept | M | orderrad metadata-fält | Finns |

## F. Fakturamodell (fält 79–87)

| # | Fält (CSV) | Källa | Hur | Var i systemet idag | Status |
| --- | --- | --- | --- | --- | --- |
| 79 | 4, Allt måste vara klart (ej delleverans) | Orderkoncept | D | `requireCompleteSegmentBeforeInvoice` | Finns |
| 80 | 5, Fakturasläpp (löpande/dag/vecka/månad) | Orderkoncept | D | `invoiceConsolidation` → `billingSegmentKey` | Finns |
| 81 | Efterfakturering / fast pris / abonnemang | Orderkoncept | D | fakturametod (`getOrderConceptMethod`) | Finns |
| 82 | Löpande pris/räkning | Orderkoncept | D | `invoiceModel` (löpande) | Finns |
| 83 | Fastpris | Orderkoncept | D | fixed price | Finns |
| 84 | Prislista | Orderkoncept | S | `price_lists` | Finns |
| 85 | Fakturalåsning (allt klart innan faktura) | Orderkoncept | D | `invoiceQueueState` (held) | Finns |
| 86 | Fakturabroms (attest innan Fortnox) | Orderkoncept | D | fakturabroms/attest (held) | Finns |
| 87 | Faktura sammanställd | System | SYS | fakturamotor → `customer_invoice` | Finns |

## G. Status (fält 88–91)

| # | Fält (CSV) | Källa | Hur | Var i systemet idag | Status |
| --- | --- | --- | --- | --- | --- |
| 88 | Uppgiftsstatus (Skapad/Grovplanerad/Finplanerad/Påväg/På plats/Utförd/Fakturerad + Omöjlig/Raderad + **Överbokad**) | System | SYS | `deriveUppgiftStatus()` | **Delvis** — "Överbokad" saknas som status (åtgärd D) |
| 89 | Tidstyp som löneunderlag | System | SYS | tidskod → `payroll-export` | Härleds |
| 90 | Affärsstatus (Offert/Ordererkännande/Fraktsedel/Följesedel/Leveransbekräftelse/Faktura) | System | SYS | dokumenttyp-map (`delivery_note` m.fl.); full kedja ej komplett | **Delvis** |
| 91 | Maskering av pris på följesedel | System | SYS | pris-maskering finns konceptuellt; explicit flagga ej bekräftad | **Delvis** |

## H. Tilldelning & ekonomikoppling (fält 92–94)

| # | Fält (CSV) | Källa | Hur | Var i systemet idag | Status |
| --- | --- | --- | --- | --- | --- |
| 92 | Vilken utförare/team tilldelats | System | SYS | assignments/work_orders tilldelning (team/fordon) | Finns |
| 93 | Kostnadsställe | System | SYS | `costCenter` (fortnox-code-derivation) | Finns |
| 94 | Projekt | System | SYS | `projectCode` (fortnox-code-derivation) | Finns |

---

## Att åtgärda (så inget hänger löst)

**Äkta luckor (Saknas):**
- **Pos Z 3D** (fält 64) — höjdkoordinat. Låg prioritet om ni inte behöver 3D-placering.
- **Yta eller sträcka** (fält 65) — objektets yta/sträcka. Låg prioritet.

**Delvis — behöver komplettering (11 fält):**
- Begränsningstyp per objekt/kund (19), Ej förbrukas-flagga (33), Visas på faktura /
  faktureras till kund som artikelflaggor (26, 27), Visade fält editable per fält (42),
  Geo-oberoende-flagga (48), "Hur objektet hittades"-klartext (54), Fastighetsägare per
  plats (66), Affärsstatus-kedjan (90 — utredd i `docs/adr-affarsstatus-kedjan.md`),
  Prismaskering på följesedel (91).

**Status-lucka:**
- **"Överbokad"** som egen uppgiftsstatus (fält 88) → åtgärd **D** (överbokning som status + krockvarning).

## Hängande trådar (motorer kvar att bygga)

- **Plockuppgiftens artikelnummer-logik** (fält 3): systemet måste välja *plocka-från-lager*
  (finns saldo) vs *beställ-hem* (slut i lager) och sätta rätt artikelnummer/uppgiftstyp.
  Lagermodellen känner saldo, men förgreningen saknas. → utvecklingslogg.
- **Abonnemangsmotorn (motor 5)**: avgiftsberäkningen är deferrad (påverkar fält 25/59/87
  i drift, men fee-uträkningen körs inte automatiskt ännu).
