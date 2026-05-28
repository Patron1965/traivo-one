# ADR v3 — Objekt-neutralitet, kund-hierarki, fakturanivåer och metadata-livscykel

**Status:** Förslag (utvidgar `adr-orderkoncept-v2.md`).
**Datum:** 2026-05-28.
**Författare:** Task #553 efter Session 2 (2026-05-28).
**Föregångare:** `adr-orderkoncept-v2.md` (orderkoncept som källa till arbetsuppgifter).
**Källmaterial:** `attached_assets/analys_rod_trad_session2_orderflode_1779969923185.pdf`.

---

## 1. Kontext

ADR v2 låste *orderkonceptet* som källa till arbetsuppgifter och flyttade
all execution till `work_orders`. Session 2 (2026-05-28) avtäckte ett
djupare arkitekturproblem som v2 inte adresserade:

> "Systemet måste supporta en logik som gör att samma objekt ska kunna
> hantera uppgifter kopplade till olika kunder."
> — Session 2

Bilbranschanalogin från sessionen sammanfattar problemet: en bil (STG 067)
ägs av Person A idag, säljs till Person B imorgon, körs till verkstaden
av Person C på fredag. Verkstadens system kan inte ha bilen *hårdkopplad*
till en ägare — det är en uppgiftsrelation, inte en grunddatarelation.

Traivos nuvarande datamodell bryter detta:

- `objects.customer_id` är `NOT NULL` (`shared/schema.ts:95`) — varje
  objekt har exakt en hårdkopplad ägare-kund.
- `object_payers` finns (rad ~1924) men används parallellt med
  `customer_id` snarare än som primär relation.
- `customer_invoices.customer_id` har bara *en* fakturamottagare per
  faktura, ingen nivå-information (central/region/lokal).
- `metadata_definitions` kan raderas (ingen referensräkning) — men
  `object_metadata`-värden refererar dem och framtida `order_concepts`
  refererar metadatanycklar via `crossPollinationField` /
  `subscriptionMetadataField`.

Session 2 formulerade fem konkreta principer som måste låsas innan
parallella tasks driver isär. Denna ADR är **rent designdokument** —
ingen kod, inga migrationer. Implementation sker i nedströms-tasks
(se §8).

### 1.1 Begrepp

- **Objekt** — en fysisk eller logisk plats/sak där arbete utförs
  (fastighet, BRF, kärl, bil, hytt). Neutralt: ingen ägare per default.
- **Kund** — en juridisk person som beställer eller faktureras.
- **Betalare (`object_payers`)** — kopplingen objekt→kund i en specifik
  rollkontext (primary, secondary, split). En tidsbestämd relation.
- **Order / orderkoncept** — beställning från en specifik kund som rör
  ett urval av objekt under en period.
- **Fakturanivå** — *vem* som faktureras (central, område, lokal). En
  metadata-association som ärvs i klusterträdet.
- **Metadata-definition** — en *fältdefinition* (t.ex. "Antal kärl",
  "Fakturamottagare-email"). Värdet hänger på objektet, definitionen är
  tenant-global.

---

## 2. Beslut

### 2.1 Objekt-neutralitet — `objects.customer_id` avvecklas

**Beslut:** Avveckla `objects.customer_id`. Kundrelation uppstår endast
via:
1. **Order** (`work_orders.customer_id` / `order_concepts.customer_id`)
   — *vem beställde detta arbete*.
2. **`object_payers`** — *vem som betalar för arbete på detta objekt*,
   med tidsfönster (`validFrom`/`validTo`), roll (`payerType`),
   prioritet och artikeltypsbegränsning.

`object_payers` blir den enda källan till "vem äger/betalar för
objektet" — det finns ingen single-source-of-truth-kolumn på `objects`.

**Migrationsstrategi (expand-contract):**

| Fas | Åtgärd | Säkerhet |
|---|---|---|
| **E1** | För varje rad i `objects` med `customer_id` IS NOT NULL och utan motsvarande `object_payers`-rad — skapa `object_payers(payerType='primary', isPrimary=true, sharePercent=100, validFrom=objects.createdAt)`. | Backfill, inga writes till hot path. |
| **E2** | Gör `objects.customer_id` `nullable`. Lägg DB-trigger som synkar `objects.customer_id` ↔ primary-`object_payers` för back-compat. | Båda källorna konsistenta. |
| **E3** | Migrera alla läsare (storage-funktioner, routes, frontend) till `resolveObjectCustomer(objectId, at?)`-helper som läser `object_payers`. Acceptera att flera kunder kan returneras. | Läsare är agnostiska för var data finns. |
| **E4** | Migrera alla skrivare till `assignObjectPayer()`-helper. Sluta skriva till `objects.customer_id`. | Inga nya hårdkopplingar. |
| **C1** | När 0 läsare/skrivare återstår: ta bort triggern. | Trigger inte längre nödvändig. |
| **C2** | `ALTER TABLE objects DROP COLUMN customer_id`. | Slutpunkt. |

**Konsekvens:**
- ✅ Samma objekt kan ha olika fakturamottagare över tid utan datakorruption.
- ✅ "Återförsäljare i Uppsala"-scenariot (§5.1) blir naturligt.
- ⚠️ Alla rapporter som joinar `objects → customers` måste skrivas om till `objects → object_payers → customers` med tidsfilter.
- ⚠️ ChainTrace/audit-loggar måste registrera *vilken payer* som var aktiv när WO skapades, inte härleda från `objects.customer_id` retroaktivt.

**Why:** "Objekt har ingen direkt kundkoppling i grunddatan… Objektet är ett 'verktyg' för att koppla på en order — inte en monetär enhet i sig." (Session 2)

---

### 2.2 Kund-hierarki (koncern → region → butik)

Sessionen ger tre konkreta hierarkityper som måste stödjas:

1. **Återförsäljare** (Uppsala): återförsäljare → slutkund.
2. **Storkund** (Familjebostäder): juridisk person → 900 objekt under en order.
3. **Kedjekund** (Axfood/Axo): koncern → region → franchisebutik (där butiker kan ha *olika juridiska ägare*).

#### Alternativ utvärderade

| Alternativ | Beskrivning | Fördelar | Nackdelar |
|---|---|---|---|
| **A. `customers.parent_customer_id`** | Self-FK på `customers` — strikt träd. | Enklast schema, naturlig för Axfood/Axo, traversal med rekursiv CTE. | Strikt träd — en franchisebutik kan inte tillhöra två koncerner. Återförsäljarrelation passar inte (det är inte ägarskap, det är "beställare-åt"). |
| **B. Separat `customer_groups`** + `customer_group_members` | Många-till-många-koppling, varje "grupp" är en nod (koncern, region). | Maximalt flexibelt — en butik kan tillhöra både "Axfood koncern" och "ICA-handlarna i Norrland". | Komplext att navigera, dubbla sanningar för "vem är min förälder". Kräver egen UI-modell. |
| **C. Utvidgad `object_payers`** med `relationship_type` | All hierarki uttrycks som payer-relationer på objektnivå. | Återanvänder befintlig tabell. Per-objekt-precision. | Förlorar kundbegreppet — "Axfood Sverige AB" är en *kund*, inte en payer-relation. Massuppdateringar blir kostsamma (en payer-rad per objekt). |

#### Beslut: **Alternativ A (`parent_customer_id`)** + **separat återförsäljarroll**

```
customers
  + parent_customer_id varchar REFERENCES customers(id) NULL
  + hierarchy_type varchar(20) NULL  -- 'koncern' | 'region' | 'lokal' | NULL
  + is_reseller boolean DEFAULT false
```

Kompletterande tabell för icke-ägar-relationer (återförsäljare,
agent, beställare-åt):

```
customer_relationships
  id, tenant_id
  from_customer_id   -- t.ex. återförsäljare i Uppsala
  to_customer_id     -- t.ex. Kalle & Birgit
  relationship_type  -- 'reseller_for' | 'orders_on_behalf' | 'service_partner'
  valid_from, valid_to
```

**Motivering:**
- Träd-modellen täcker Axfood-scenariot rent (koncern→region→butik) och Familjebostäder-scenariot (enskild kund med 900 objekt → ingen parent).
- Strikta träd är begripliga för planeraren — en butik tillhör *en* koncern. Multi-tillhörighet (B) hade ökat UI-komplexitet utan affärsnytta.
- Återförsäljarscenariot (Uppsala) är inte ägarskap utan en *beställar*-relation — det hör hemma som egen kant (`customer_relationships`), inte i hierarki-trädet.
- Trädet konsumeras av (a) `object_payers`-resolvern som faller uppåt vid avsaknad av lokal payer, (b) fakturanivå-resolvern i §2.3.

**Konsekvens:**
- ⚠️ Cykelskydd krävs: ingen kund får ha sig själv som ancestor. Migrationen lägger CHECK + recursive validation.
- ⚠️ Soft-delete av koncern måste tvinga lyft av alla barn eller blockera deletion (samma princip som §2.4).
- ✅ Rapport "vad fakturerar vi Axfood för" blir en rekursiv CTE — etablerat mönster.

**Why:** "Centralt beställer tvätt i region 5 & 6. Men franchise-butiker har olika juridiska ägare." (Session 2)

---

### 2.3 Tre fakturanivåer (central / område / lokal) — med arv och konflikt­resolution

#### Datamodell

```
invoice_recipients
  id, tenant_id
  customer_id           -- vilken kund denna recipient hänger på
  level                 -- 'central' | 'area' | 'local'
  recipient_name        -- "Axfood Ekonomi", "Kajsa Andersson"
  recipient_email
  invoice_address, postal_code, city
  fortnox_customer_id   -- mappning till externt system
  valid_from, valid_to
  priority              -- vid flera på samma nivå
  notes
```

Varje *kund* (på valfri nivå i hierarkin från §2.2) kan ha 0–n
recipients per nivå. Recipienten ärvs nedåt i kundhierarkin om
underliggande kund inte har egen recipient på samma nivå.

#### Arvsregler (resolution)

För en given `work_order` resolveras fakturamottagare så här:

```
resolveInvoiceRecipient(workOrder, asOf):
  payer = primary object_payer för workOrder.object_id @ asOf  (§2.1)
  candidates = []

  för varje level i ['local', 'area', 'central']:
    customer = payer.customer
    while customer:
      r = invoice_recipients @ asOf där customer_id=customer.id och level=level
      om r finns: candidates.push({level, source: customer.id, recipient: r}); break
      customer = customer.parent

  return resolveByPolicy(candidates, workOrder.invoiceLevelHint)
```

#### Kapningsregler (breaks_inheritance)

På varje nivå kan en kund explicit *kapa* arvet uppåt:

```
invoice_recipients.breaks_inheritance boolean DEFAULT false
```

Om `breaks_inheritance=true` på en regionnivå-recipient → fakturor som
träffar denna region går till regionen, *aldrig* upp till koncernen,
även om koncernen har en central recipient. Detta är "Kajsa-trädet"
från sessionen (§5.4).

#### Konfliktresolution (motstridig information)

Tre fall där konflikt kan uppstå:

| Fall | Exempel | Resolution |
|---|---|---|
| **F1: Två recipients samma nivå, samma kund** | Två "central"-rader på Axfood AB. | Använd `priority` (DESC), sedan `valid_from` (DESC). Inga konflikter — deterministiskt. |
| **F2: Lokal vill överstyra ärvd region** | Löfberg's butik har egen lokal-recipient; region har också en region-recipient. | Lokal vinner alltid över ärvd nivå. Detta är "enskild butik ringer och vill ha specialtvätt med direktfaktura" (Session 2). |
| **F3: Order kräver specifik nivå** | Manuell `workOrder.invoiceLevelHint='central'` på en order som har lokal recipient. | Honorera hinten — men sätt `invoice_conflict_flag=true` på WO och kräv operatör-confirm vid fakturapreview. |

**UI-trigger för varning:** Fakturapreview-vyn måste visa varningsbanner
när `candidates.length > 1` *före* kapnings­resolution — så operatören
ser att flera recipients var i spel. Vad bannern säger / hur den ser
ut är **utanför scope** för denna ADR (`Out of scope` §3).

**Why:** "Vi har två stycken metadatafält som ger motstridig information. Då behöver systemet ha en fråga: Vad är det som gäller?" (Session 2)

**Konsekvens:**
- ✅ Axfood-fall: centralfakturering default; en region kan kapa; en butik kan kapa ytterligare. Allt deklarativt.
- ⚠️ `customer_invoices.customer_id` blir otillräckligt — behöver kompletteras med `invoice_recipient_id` så vi vet vilken specifik recipient som mottog.
- ⚠️ Fortnox-export måste mappa `invoice_recipient.fortnox_customer_id`, inte `customer.fortnox_customer_id`. Frozen-pricing-logiken (`adr-orderkoncept-v2.md` §3) gäller — recipienten fryses på WO vid första fakturering.

---

### 2.4 Metadata-livscykel — soft-delete + referensräkning

#### Princip (bokföringsanalogi)

> "Jämförs med kontoplan i bokföring — samma logik, du kan inte ta bort
> ett konto som har transaktioner." (Session 2)

En `metadata_definition` är som ett konto i kontoplanen. Den får inte
raderas så länge den refereras av *värden* eller *koncept*. Den får
inte heller döpas om så att gamla värden tappar mening.

#### Datamodell (tillägg till `metadata_definitions`)

```
metadata_definitions
  + deleted_at timestamp NULL          -- soft-delete
  + replaced_by_definition_id varchar NULL  -- vid splittring/omdöpning
  + reference_count int DEFAULT 0      -- cachat värde, async-uppdaterat
  + last_reference_check timestamp NULL
```

#### Referensräkning

Referenser räknas över:

1. `object_metadata.definition_id` (befintliga värden).
2. `order_concepts.crossPollinationField` (matchas mot `fieldKey`).
3. `order_concepts.subscriptionMetadataField` (matchas mot `fieldKey`).
4. **Framtida ordrar:** `order_concepts` med `nextRunDate >= NOW()` och `status='active'` som refererar fältet räknas separat (kritisk varning, inte bara info).

#### Tillåtna operationer

| Operation | Tillåten när |
|---|---|
| **Skapa** | Alltid. |
| **Ändra `fieldLabel` / `validationRules` / `sortOrder` / `isRequired`** | Alltid. |
| **Ändra `fieldKey`** | **Aldrig.** `fieldKey` är immutable — använd `replaced_by` istället. |
| **Ändra `dataType`** | Endast om `reference_count = 0`. |
| **Soft-delete (`deleted_at`)** | Tillåten alltid, men kräver explicit `force=true` om `reference_count > 0`. Befintliga värden blir read-only-historik. |
| **Hard-delete** | Endast om `reference_count = 0` *och* `deleted_at IS NOT NULL` *och* `deleted_at < NOW() - INTERVAL '90 days'`. |
| **Splittring (1→N)** | Skapa N nya definitioner; sätt gamlas `replaced_by_definition_id`; soft-delete den gamla. Migrera värden i separat job med audit-trail. |

#### Varningssystem

`DELETE /api/metadata-definitions/:id` returnerar `409 Conflict` om:
- `reference_count > 0` *utan* `?force=true`.
- *Eller* om någon `order_concept` med `nextRunDate >= NOW()` refererar fältet (**alltid** blockera — kräver explicit migration-flow först).

Returnerar payload med vilka koncept/objekt som refererar — så
operatören kan agera.

**Why:** "Då kommer de framvarande ordrarna som har uppgifter kopplade till… från att vara tio stycken tvättar, då står det 'oj, nu är det ingenting'. Och då kanske de försvinner." (Session 2)

**Konsekvens:**
- ✅ Antal-fält-scenariot (sessionen) — splittring av "Antal" → 4 fält tvingar explicit migrations-flöde, gamla ordrar fortsätter fungera.
- ⚠️ Soft-delete betyder att UI:t måste filtrera `deleted_at IS NULL` i alla väljare. Historik-vyer (gamla WO) ska fortfarande visa fältnamnet.
- ⚠️ Referensräkning bör underhållas via trigger på `object_metadata` insert/delete för konsistens; alternativt nattligt batch-job med tolerans.

---

### 2.5 Samlingsfakturor (konsolidering)

#### Datamodell

```
invoice_consolidation_policies
  id, tenant_id
  customer_id              -- vilken kund/recipient policyn gäller för
  invoice_recipient_id     -- valfritt: per-recipient override
  period                   -- 'daily' | 'weekly' | 'monthly'
  period_anchor            -- veckodag/månadsdag när period stängs
  hold_until_period_end    boolean DEFAULT true
  active boolean
  valid_from, valid_to

customer_invoices  (utvidgning)
  + state varchar(20) DEFAULT 'pending'
        -- 'pending' | 'held' | 'consolidated' | 'sent' | 'paid' | 'cancelled'
  + consolidation_batch_id varchar NULL
  + held_until timestamp NULL
  + invoice_recipient_id varchar NULL   -- från §2.3
```

#### State-machine

```
              draft
                │
                ▼
   ┌────► pending ──────► sent ────► paid
   │       │   ▲
   │       ▼   │ (consolidation window stänger)
   │      held │
   │       │   │
   │       ▼   │
   │  consolidated ─────► sent
   │
   └── cancelled (terminalt från valfritt icke-`sent`/`paid`-state)
```

Övergångar:
- **`pending → held`** — vid skapande, om aktiv `consolidation_policy` finns och vi är *inom* konsolideringsperioden.
- **`held → consolidated`** — vid period-stängning, slå ihop alla `held`-fakturor för samma recipient + period till en ny `consolidated` "parent"-faktura. Originalfakturorna pekar via `consolidation_batch_id`.
- **`consolidated → sent`** — när konsoliderad faktura skickas (Fortnox-export, e-post).
- **`pending → sent`** — om ingen policy träffar (default, oförändrat beteende för befintliga tenants).

#### "Bromsa fakturor"

En användare kan sätta `state='held'` manuellt på en `pending`-faktura
med `held_until`-datum — fakturan deltar då inte i nästa konsolidering
förrän den övergår tillbaka till `pending` (manuellt eller via TTL).

**Why:** "Konsolidera fakturor per dag/vecka/månad" + "Automatiskt hålla fakturor tills konsolideringsperioden" (Session 2).

**Konsekvens:**
- ✅ Ger Familjebostäder en faktura/månad istället för 900 stycken.
- ⚠️ Frozen-pricing från ADR v2 §3 måste appliceras *vid `pending`*, inte vid `consolidated` — annars förändras priser inom perioden.
- ⚠️ Fortnox-export måste hantera "parent + children"-strukturen — antingen skicka konsoliderad som rad-rik faktura, eller länka externt-ID:n.

---

## 3. Out of scope

- **UI/UX för konfliktvarningar** — denna ADR specificerar *när* en varning ska visas (§2.3 F2/F3) men inte hur den ser ut eller var den placeras.
- **Implementations-PR per fält** — varje beslutsområde får egen task i §8.
- **Exakt SQL för migrationer** — beslutet är "expand-contract", konkret DDL skrivs i bygg-task.
- **Beslut om kund-hierarki-modell B/C** — A är vald; B/C är diskvalificerade i §2.2 och tas inte upp igen.
- **AnnualPlanning / VRP-integration** — fakturanivåer påverkar inte rutt­optimering direkt; frikopplad domän.
- **Modus-import-anpassning** — separat task när modellen är stabil.

---

## 4. Förhållande till tidigare beslut

| Tidigare beslut | Påverkan av ADR v3 |
|---|---|
| **ADR v2 §2.1** (en enda `work_orders`-tabell) | Oförändrat. WO bär `customer_id` som *order*-relation (vem beställde), inte som payer-relation. |
| **ADR v2 §3** (frozen pricing vid fakturering) | Utvidgas: även `invoice_recipient_id` fryses vid första `pending`. Recipienten kan inte ändras retroaktivt. |
| **ADR v2 §7.2** (`delivery_preferences` på `objects`/`customers`) | Oförändrat. Preferenser är *objektsdata*, inte payer-data. |
| **`customers.deliveryPreferences`** (`shared/schema.ts:72`) | Oförändrat. Fungerar parallellt med fakturanivåer. |
| **Expand-contract-strategin** (replit.md) | Konkret tillämpning i §2.1 (`objects.customer_id`). |

---

## 5. Scenariotester

Konkreta scenarier från Session 2 och förväntat systembeteende efter
ADR v3-implementation.

### 5.1 Återförsäljare i Uppsala

**Setup:**
- Återförsäljare AB (kund, `is_reseller=true`).
- Kalle & Birgit (kund, ingen parent).
- `customer_relationships`: Återförsäljare AB `orders_on_behalf` Kalle & Birgit.
- Objekt: Bilen STG 067, `object_payers = [primary: Kalle & Birgit @ 2026-05]`.

**Order A:** Återförsäljaren beställer service på STG 067.
- WO skapas med `customer_id = Återförsäljare AB` (beställare).
- `resolveInvoiceRecipient` följer `object_payer = Kalle & Birgit`.
- Faktura går till Kalle & Birgits recipient. ✅

**Order B:** Kalle ringer själv en månad senare.
- WO skapas med `customer_id = Kalle & Birgit` (beställare).
- `object_payer` är fortfarande Kalle & Birgit.
- Faktura går till samma recipient. ✅
- Återförsäljaren är inte inblandad i fakturan.

### 5.2 Familjebostäder (1 order, 900 objekt)

**Setup:**
- Familjebostäder AB (kund, ingen parent).
- 900 objekt, alla med `object_payers = [primary: Familjebostäder]`.
- `invoice_consolidation_policy(customer=Familjebostäder, period='monthly')`.

**Order:** "Tvätta alla 900 BÖB innan 30 juni."
- Orderkoncept skapas med `targetClusterId` som spannar 900 objekt.
- 900 WO skapas (ADR v2 §2.1).
- Vid fakturering: 900 `pending`-fakturor → `held` → konsolideras månadsvis → 1 (eller 2, beroende på span) `consolidated`-faktura. ✅

### 5.3 Axfood/Axo (koncern → region → franchise)

**Setup:**
- `Axfood Sverige AB` (kund, `hierarchy_type='koncern'`, ingen parent).
- `Axfood Region 5` (kund, parent=Axfood Sverige, `hierarchy_type='region'`).
- `Axfood Region 6` (kund, parent=Axfood Sverige, `hierarchy_type='region'`).
- `ICA-Löfberg` (kund, parent=Region 5, `hierarchy_type='lokal'`, **separat juridisk person**).
- Objekt i Löfberg-butiken har `object_payers = [primary: ICA-Löfberg]`.
- `invoice_recipients`:
  - Axfood Sverige AB: `level='central'`, "Axfood Ekonomi".
  - Region 5: ingen.
  - ICA-Löfberg: ingen.

**Order A:** Central beställning "Tvätta alla i Region 5 & 6".
- 200 WO skapas på objekt under båda regionerna.
- För varje WO: `resolveInvoiceRecipient` följer `object_payer` (Löfberg eller annan butikskund) → traverserar upp → träffar central recipient på Axfood Sverige AB.
- Alla 200 fakturor → Axfood Ekonomi. ✅

**Order B:** Löfberg lägger till en lokal recipient för sin butik.
- Ny `invoice_recipients(customer=ICA-Löfberg, level='local', email=Löfberg)`.
- Nya WO på Löfberg-objekt: lokal vinner (F2 i §2.3).
- Befintliga `held`-fakturor påverkas inte (frozen-pricing-principen). ✅

### 5.4 Kajsa-trädet (arv → regionchef tar över → butik överstyr)

**Setup:**
- Koncern: Kajsa Holding AB. Recipient: `central`, email=kajsa@.
- Region: Norrlandsregionen, parent=Kajsa Holding. Recipient: *ingen initialt*.
- Butik: Sundsvallsbutiken, parent=Norrlandsregionen.

**T0:** Kajsa har satt central-recipient. Alla fakturor → kajsa@.

**T1:** Norrlandsregionen får ny chef. Region får
`invoice_recipients(level='area', email=region@, breaks_inheritance=true)`.
→ Fakturor för objekt under regionen går nu till region@. **Kajsa får inga
mer** (kapad). ✅

**T2:** Sundsvallsbutiken ringer: "Vi vill ha specialtvätt med
direktfaktura." Lokal recipient skapas på Sundsvallsbutiken
(`level='local'`).
→ WO för Sundsvallsbutikens objekt: lokal vinner (F2). Övriga butiker
i regionen: region@ (oförändrat). Kajsa: fortsatt inget. ✅

**T3 (konflikt-test):** En manuell WO med `invoiceLevelHint='central'`
skapas på Sundsvallsbutiken.
→ F3 utlöses: central-recipient (kajsa@) används, men WO flaggas
`invoice_conflict_flag=true`. Operatör måste confirmera vid
fakturapreview. ✅

### 5.5 Metadata-splittring (Antal → 4 fält)

**Setup:**
- `metadata_definition(field_key='antal', dataType='number')`, refererad av 15 `object_metadata`-rader och 20 framtida `order_concepts`.

**Försök 1:** `DELETE /api/metadata-definitions/antal`.
→ 409 Conflict, payload listar 15 objekt + 20 koncept. ✅

**Försök 2:** Operatör skapar `antal_karl`, `antal_botten`, `antal_kompost`, `antal_grov` och en migrations-mapping.
→ Värden migreras (audit-trail). `antal` får `replaced_by_definition_id=antal_karl` (default vid otydlig mapping), soft-deletas. Framtida koncept måste *aktivt* migreras eller bryta. ✅

**Försök 3:** Hard-delete `antal` efter 90 dagar.
→ Tillåts om `reference_count=0`. ✅

---

## 6. Konsekvenser (övergripande)

### 6.1 Positiva
- En modell som hanterar verklighetens röra: samma objekt, olika kunder, olika fakturamottagare över tid.
- Konfliktresolution är deterministisk och dokumenterad — slutar bli operatörshäxeri.
- Metadata-livscykeln slutar tappa data; bokföringsanalogin håller systemet hederligt.
- Konsolideringsstöd löser Familjebostäder-pain utan special-kod.

### 6.2 Negativa / risker
- **Stor migration:** `objects.customer_id` finns i ~14 tabeller via join och i frontend. Expand-contract är säker men långsam.
- **Rapporter måste skrivas om** — alla "objekt per kund"-rapporter går från en SQL-join till en tidsfiltrerad payer-lookup.
- **Mer komplext datamodell att lära in** för nya utvecklare. ADR v3 + ADR v2 + scenariotester måste vara läsbara introduktioner.
- **Risken för "tom ägare":** Om alla `object_payers` upphör att gälla (utgånget `valid_to`) — vad händer med en ny order? Beslut: ordern kan skapas men UI varnar; faktureringen blockeras tills payer återställs.

### 6.3 Backåtkompatibilitet
- Befintliga tenants utan konsoliderings-policy: oförändrat beteende (`pending → sent` direkt).
- Befintliga koncept utan parent: oförändrat (`parent_customer_id=NULL`).
- Befintliga `metadata_definitions`: får `reference_count` populerat retroaktivt; nuvarande UI-flöde fortsätter funka.

---

## 7. Migration impact mot tidigare MERGED-tasks

| Task | Område | Förhållande till ADR v3 |
|---|---|---|
| **#12 (object_payers grund)** | §2.1 | Tabellen finns redan. ADR v3 gör den till *primär* källa istället för parallell. Inga schema-ändringar i §2.1 *tabellen* — bara konsumtionsmönstret. |
| **#74 (metadata_definitions + propagation)** | §2.4 | Tabellen finns. ADR v3 lägger `deleted_at`, `replaced_by`, `reference_count`. Befintlig propagationslogik (`fixed/falling/dynamic`) oförändrad. |
| **#381 (customer_invoices + Fortnox-export)** | §2.3, §2.5 | Befintlig en-recipient-modell otillräcklig. Lägg `invoice_recipient_id`, `state`, `consolidation_batch_id`. Frozen-pricing-logiken (ADR v2 §3) återanvänds. |

---

## 8. Nedströms-tasks (ej i scope för denna ADR)

Denna ADR är ett designdokument. Implementationsarbete bryts ut i
separata tasks som redan är planerade:

1. **Avveckla `objects.customer_id` (expand-contract)** — §2.1.
2. **Kund-hierarki (koncern → region → butik)** — §2.2.
3. **Tre fakturanivåer med arv och konfliktvarning** — §2.3.
4. **Metadata-livscykelskydd (reference counting + soft-delete)** — §2.4.
5. *Samlingsfakturor (§2.5) — separat task när §2.3 är på plats.*

---

## 9. Referenser

- `docs/adr-orderkoncept-v2.md` — orderkoncept som källa till arbetsuppgifter.
- `attached_assets/analys_rod_trad_session2_orderflode_1779969923185.pdf` — sessionsunderlag.
- `shared/schema.ts` — `objects` (64-110), `object_payers` (1920-1940), `metadata_definitions` (2025-2080), `order_concepts` (2309-2400), `customer_invoices` (3380-3398).
- `replit.md` — projektöversikt och Gotchas.
