# Traivo Go — Anpassningsrapport (vad som ändrats i Traivo One och vad Go behöver förenkla)

**Syfte:** En samlad, aktuell överlämning från backend-teamet (Traivo One) till
chaufförsappen **Traivo Go**. Rapporten inventerar de ändringar i Traivo One som
påverkar fältappen och pekar, ändring för ändring, ut **vad som ska förenklas/anpassas
i Go och varför**. Den ersätter inte de tidigare dokumenten — den bygger vidare på dem
och **rättar det som blivit inaktuellt**.

**Källa till sanning:** Traivo One:s faktiska mobil-routes (`server/routes/mobile/*`).
Denna rapport är verifierad mot koden 2026-07-08.

**Läs först (bakgrund, fortfarande giltiga):**
- `docs/traivo-go-integrationshandbok.md` — endpoint-katalog, auth, statusvärden.
- `docs/traivo-go-v2-handover.md` — frozen-pris, BOM-checklista, beroenden på `v2/orders/:id`.
- `docs/traivo-go-integration-rapport.md` — säkerhetshärdning + nya order/artikel-fält.
- `docs/traivo-go-api-match-report.md` — de 8 kvarstående app↔backend-avvikelserna.

---

## 0. Sammanfattning för Mats (icke-teknisk)

Traivo One (systemet i webben) har byggts på en hel del sedan chaufförsappens
handbok skrevs (23 juni). Det viktigaste chaufförsappen behöver anpassa sig efter:

1. **Antal går nu att redigera i fält.** Handboken sa "antal går inte att ändra i
   fält" — det stämmer inte längre. Systemet stödjer nu att chauffören justerar antal
   och registrerar "taget/förbrukat antal" (det som styr svinn och retur till lager).
   Go bör visa **en enkel antals-ruta per rad** och låta servern bestämma när den får
   redigeras — inte bygga egen logik.
2. **Metadata visas och fylls i grupperat.** Fält som hör ihop (t.ex. allt under
   "Kontakt") kommer nu färdiggrupperade från servern. Go ska visa dem grupperat i
   stället för som en lång platt lista.
3. **Föraren ser bara riktiga arbetsorder.** Systemets nya "orderkoncept" och "avrop"
   omvandlas först till vanliga arbetsorder — det är enbart dessa chauffören ser. Det
   **förenklar** appen: en enda ordermodell, inga specialfall.
4. **"Utförd" betyder inte "fakturerad".** Ett jobb kan vara klart i fält men ändå
   inte gå till faktura (fryst pris, faktureringsbroms, samlingsfaktura). Go måste
   säga rätt sak i appen.
5. **Webbens meny lades om i juli** (t.ex. borttagen startöversikt, dolda rapporter).
   Det är en **webb-ändring** och påverkar inte chaufförsappens data — men Go bör hämta
   sina benämningar (objekt/resurs osv.) från servern så orden hålls lika.
6. **Utförandekoder/ikoner** finns nu som register i webben, men mobil-ytan skickar
   bara en enkel kod-text. Här finns ett **beslut** att ta (se §8/§11).

Resten av rapporten är teknisk och riktar sig till Go-teamet. **Inga kodändringar
görs i fältappen som en del av detta uppdrag — detta är en ren rapport/överlämning.**

---

## 1. Klientlandskapet — tre saker att hålla isär

Det finns tre olika komponenter som ofta blandas ihop. Håll isär dem:

| Komponent | Vad det är | Auth | Endpoints |
|---|---|---|---|
| **Traivo One** | Backend + webbapp (detta repo) | Replit-session / cookie | alla `/api/*` |
| **Traivo Go** | Fristående chaufförsapp (eget repo, rebrandad "Plannix" i UI) | **Bearer-token** | **endast `/api/mobile/*`** |
| **SimpleFieldApp** | In-repo mobil-UI på `/mobile` (referens/fallback) | hybrid: session + mintar mobil-token | `/api/mobile/*` + `/api/*` |

**Varför det spelar roll för Go:**
- Denna rapport riktar sig till **Traivo Go** (den fristående appen). Använd **enbart
  `/api/mobile/*`** med bearer-token.
- **`SimpleFieldApp` (in-repo) är er referensimplementation.** Den konsumerar redan
  alla de nya endpoints som beskrivs nedan (antal, taget antal, metadata-context,
  metadata-update). När ni är osäkra på svarsform eller flöde — titta på hur den
  anropar dem (`client/src/components/SimpleFieldApp.tsx`), så slipper ni gissa.
- `/api/mobile/*` går **utanför** den vanliga tenant-middleware. Handlers härleder
  tenant från den **ägda resursen**, aldrig från `req.tenantId`. Vanliga cookie-`/api/*`
  fungerar därför inte med bearer-token.

---

## 2. NYTT: Antal i fält (rättar handbokens §9)

> **Handboken §9 säger:** *"Antalsredigering finns inte i fält. Traivo Go har medvetet
> inget redigerbart antalsfält — antalsflaggor är display-only."*
> **Detta är inaktuellt.** Ta bort den regeln.

Traivo One har nu tre endpoints för antal i fält, alla via
`GET /api/mobile/tasks/:id/metadata-context` som datakälla:

### 2.1 `GET /api/mobile/tasks/:id/metadata-context`
Returnerar bl.a. `orderArticles[]`, en rad per orderrad, med de fält Go behöver för
att rita antals-UI:t **utan egen logik**:

| Fält | Betydelse |
|---|---|
| `lineId`, `articleId`, `articleName`, `articleNumber` | radidentitet |
| `quantity`, `quantityUnit` | fakturerat/beställt antal |
| `quantityMode` | hur antalet styrs (`per_styck`/`matches_field`/formel/fast) |
| `hideQuantityInApp` | **true = dölj antalet** (fast/härlett — används automatiskt ändå) |
| **`editableQuantity`** | **true = visa redigerbar antals-ruta** (fakturerat antal) |
| `shouldBeReturned`, `hasStockLocation` | retur-/pantflöde + om artikeln kan ruttas till lager |
| `takenQuantity`, `wasteQuantity`, `returnedQuantity`, `quantityReconciliationNote` | taget antal + härledd svinn/retur |
| **`takenQuantityEditable`** | **true = tillåt registrering av taget antal** |

### 2.2 `POST /api/mobile/tasks/:id/quantity-update` — `{ lineId, quantity }`
Justerar det **fakturerade** antalet. Servern skriver tillbaka på två ställen
(orderraden + objektets antals-metadatafält) och räknar om ordertotaler.
Tillåts **endast** när `editableQuantity=true`.

### 2.3 `POST /api/mobile/tasks/:id/taken-quantity-update` — `{ lineId, takenQuantity, note? }`
Registrerar **verkligt taget/förbrukat** antal (Uppgiftslogik v1, "kolumn T").
Servern härleder svinn/retur och **rör aldrig** det fakturerade antalet.
Tillåts när `takenQuantityEditable=true`.

### Vad Go ska förenkla/anpassa — och varför
- **Visa högst EN antals-kontroll per rad, och låt servern styra den.**
  Rita redigerbart fält **bara** när `editableQuantity=true`; dölj antalet helt när
  `hideQuantityInApp=true`. Bygg **ingen** egen "får jag redigera?"-logik i appen —
  villkoren (metadata-styrt, fält valt, artikel aktiv, ej dold, ordern ej fakturalåst)
  avgörs redan server-side och speglas i flaggan. *Varför:* flaggorna kan ändras utan
  att appen släpps om; dubblerad logik driver isär.
- **"Taget antal" är en separat, valfri registrering** (för svinn/retur), inte samma
  sak som antalsjustering. Håll dem åtskilda i UI:t.
- **Fakturalås = allt låst.** När ordern är `consolidated`/`exported` (eller redan
  ligger på en konsoliderad faktura) blir både `editableQuantity` och
  `takenQuantityEditable` `false`. Rita då read-only. *Varför:* fakturaintegritet —
  servern avvisar annars med fel.

---

## 3. NYTT/UTÖKAT: Metadata i fält — familj-gruppering, områdesfilter, "allt är metadata"

`metadata-context` returnerar nu även `showMetadataFields[]` och
`leaveMetadataFields[]` — den nya modellen för "visa aktuellt metadatavärde" resp.
"lämna in ett nytt värde vid utförande".

### 3.1 Familj-/grupp-expansion (`groupField`)
När en artikel pekar på ett **grupp-/familjefält** (t.ex. "Kontakt") expanderar servern
det till dess barnfält **före** värdeuppslag — grupp-föräldern bär aldrig ett eget
värde. `groupField` är förälderns namn så att appen kan **gruppera barnen visuellt
under en rubrik**.

| `showMetadataFields[]` | `leaveMetadataFields[]` |
|---|---|
| `articleId`, `articleName`, `metadataField`, `groupField` | `articleId`, `articleName`, `metadataField`, `groupField` |
| `clarification`, `canUpdate` | `instruction`, `required` |
| `currentValue`, `displayValue` | `currentValue`, `displayValue` |

**Skriv tillbaka:** `POST /api/mobile/tasks/:id/metadata-update` —
`{ articleId, metadataLabel, newValue, inspectionStatus?, inspectionComment?, inspectionPhoto? }`.

**Vad Go ska göra:**
- **Gruppera på `groupField`** i stället för en lång platt lista. *Varför:* speglar hur
  fälten är tänkta att fyllas i.
- **Skicka alltid barnets `metadataField`, aldrig förälderns.** Grupp-föräldern har
  inget värde; skrivningen avvisas (IDOR-skydd: fältet måste vara konfigurerat som
  uppdaterbart på någon av orderns artiklar).
- **Obligatoriska `leaveMetadataFields` (`required=true`) blockerar klarmarkering** —
  se §6 (400-flödet).

### 3.2 Områdesfilter (område) — WEBB-ONLY idag, mobil-gap
I webben grupperas och filtreras metadata numera även per **område** (`area` på
metadata-katalogen, t.ex. "Söderort", annars "annat") — se objekt-360-vyn och
tenant-config. Det ligger **ovanpå** familj-grupperingen: område = grov indelning,
familj/`groupField` = fält som hör ihop.

**Mobil-läget just nu:** `metadata-context` exponerar `groupField` (familj) men **inte**
`area`/område. Go kan alltså gruppera på familj men **kan inte** filtrera/gruppera på
område förrän backend lägger till `area` på metadata-context-raderna.

**Vad Go ska göra:** gruppera på familj nu; behandla område-filter som **beslut** (§11).
Om fältappen behöver område-indelning/filter → additiv backend-ändring (lägg `area` på
raderna); annars är område en webb-only bekvämlighet som Go kan hoppa över.

### 3.3 "Allt är metadata" + endast svenska katalogen
- **Modellen (Steg 1, presentation-only):** i webben projiceras legacy objekt-kolumner
  (adress, position, systemgenererade fält m.m.) som **read-only metadata-rader** med
  en KÄLLA-tagg (D=data/M=metadata/S=system/SYS). Det är ingen migrering — bara ett
  enhetligt sätt att visa fälten. **För Go:** behandla härledda/systemgenererade värden
  som **read-only** (låst render, inte DB-lås). Erbjud bara skrivning där `canUpdate`/
  `required` säger det; redigera aldrig ett systemhärlett värde via metadata-vägen.
- **Bara det svenska metadata-systemet finns kvar.** *Varför:* handbokens §6-varning om
  "två parallella metadata-system (engelskt + svenskt)" är **inaktuell** — det engelska
  systemet är borttaget. Mobil-ytan skriver alltid det svenska; ni behöver inte längre
  fundera på vilket system en endpoint träffar.

---

## 4. Datamodell för föraren: Go ser BARA `work_orders`

Detta är en **grundregel** som förenklar Go rejält.

- Traivo One skapar arbete via **orderkoncept** (abonnemang/schema) och **avrop**
  (call_off). Beroende på koncepttyp landar expansionen i `assignments` och/eller
  `work_orders`, eller går direkt till fakturering (abonnemang). **Avrop (call_off)
  hamnar i `assignments` och projiceras aldrig automatiskt till `work_orders`.**
- **Alla mobil-order-endpoints läser `work_orders`** (`my-orders`, `orders/:id`,
  `v2/orders/:id`). Följd: en uppgift syns i fält **först när den finns som work_order**.
  Uppgifter som bara ligger i `assignments` (inkl. avrop) är (medvetet) osynliga för
  föraren tills en assignment→work_order-projektion sker.
- Koncept-authorad data (t.ex. leveransrestriktioner, koncept-fält) bär `work_orders`
  **inte** som join — den beräknas per objekt vid läsning och visas på jobbkortet.

**Vad Go ska göra:**
- **Lita enbart på mobil-order-endpoints** (work_orders-härledda). Bygg **ingen** egen
  hämtning av orderkoncept eller avrop — de hör inte hemma i fält-appen.
- Om en uppgift "saknas" är den (korrekt) inte projicerad än — det är inte ett appfel.
- *Varför förenkling:* en enda ordermodell, inga koncept-/avrops-specialfall i klienten.

---

## 5. Order/artikel-fält från v2 (recap — fortfarande giltigt)

Detaljerna finns i `integration-rapport.md §3` och `v2-handover.md`. Kort:
`GET /api/mobile/v2/orders/:id` bär `frozen.*`, `bomChecklist`, `dependencyStatus`/
`canStart`/`blockedBy`, samt föruppgifter (`isPreTask`/`parentWorkOrderId`).
`articles[]` bär (v1+v2) `files`, `reportingType`, `reportingMetadataField`,
`shouldBeReturned`, `productionTimeMinutes`/`productionTimeSource`.
**Ingen ändring sedan dess — ta med det som redan planerat.**

---

## 6. Utförd ≠ fakturerad + klarmarkering

- **Fakturastatus:** en utförd order kan vara fryst (`frozen.isFrozen`), bromsad
  (`invoiceBrake`) eller köad (`invoiceQueueState` = `held`/`consolidated`/`exported`).
  Go ska **aldrig** anta att "utförd = fakturerad". Visa t.ex. "påverkar inte
  fakturasumma — frusen order" när material/foto läggs till på en fryst order.
- **Klarmarkering — servern sköter statusfälten åt er.** Skicka bara `status:"utford"`
  (eller `"completed"`) till `PATCH /api/mobile/orders/:id/status`. Servern sätter då
  **både** `orderStatus="utford"` och `executionStatus="completed"` och kör
  obligatorisk-kontrollen (obligatoriska `leaveMetadataFields`, 400-flödet i §3.1).
  Skicka **inget** eget `executionStatus`-fält — det finns ingen sådan parameter.
- **OBS offline-sync-lucka:** klarmarkering via offline-sync (`POST /api/mobile/sync`
  med `status_update`) kör **inte** obligatorisk-kontrollen. Vill ni att 400-flödet för
  obligatoriska fält ska gälla — klarmarkera via PATCH-endpointen när ni är online.

---

## 7. Recap: säkerhetshärdning + orderkoncept-effekter (oförändrat)

Fortfarande giltigt från `integration-rapport.md §2 + §4`:
- **Webb-rutter är låsta bakom `requirePlanner`.** Om Go någonstans råkar anropa
  `/api/checklist*` eller `/api/quick-action` (utan `/mobile`-prefix) → byt till
  **`/api/mobile/*`-varianten** (`POST /api/mobile/quick-action`,
  `GET|POST /api/mobile/orders/:id/checklist`).
- **Orderkoncept-genererade order** kan landa på olika datum (`intervalFlexDays`), ha
  kund härledd per objekt (`customerMetadataField`), och leveransrestriktioner
  (soft/hard). Effekterna syns på ordern; själva koncept-fälten exponeras medvetet
  inte på `/api/mobile/*` (jfr §4).

---

## 8. Utförandekoder & ikoner — LÄGE + BESLUT

**Nuläge i backend:** Traivo One har byggt ett riktigt **utförandekod-register** +
central ikon-renderare (RegistryIcon) i webben. **Men mobil-ytan exponerar bara en
tunn härledning:** `executionCodes` på ordern byggs som
`order.executionCode ? [{ id, code: STORA_4_TECKEN, name: executionCode }] : []` —
alltså rå kod-text, utan register-namn eller ikon.

**Konsekvens för Go:** appen kan visa en kort kod men **kan inte** rendera korrekt
etikett/ikon från registret idag.

> **Beslut som behövs (se §11):** ska vi lägga till en mobil-endpoint som exponerar
> utförandekod-registret (kod → namn + ikon) så att Go kan visa riktiga etiketter/ikoner,
> eller räcker den korta koden i fält?

---

## 9. Navigations- & terminologiändringar (juli 2026)

Webbnavigeringen lades om i juli 2026: startöversikten ("Dashboard") togs bort (start =
"Idag"), rapport-/analyssidor **dolda** ur menyn (ska ersättas av en filterstyrd
Excel-export från Grovplaneringen), Ekonomi-menyn samlades kring Fortnox/ekonomi,
AI-menyn parkerades och en ny "Snabborder" tillkom. **Allt detta är webb-only och
ändrar inte `/api/mobile/*`.**

**Relevans/anpassning för Go:**
- **Hämta terminologi från `GET /api/mobile/terminology`** (redan listad som "bonus" i
  api-match-report). Den returnerar sammanslagen terminologi (system-default + bransch +
  tenant-labels som `labelKey → labelValue`, t.ex. objekt/resurs/fordon). **Hårdkoda
  inte** etiketter i appen — läs dem härifrån så att Go följer samma benämningar som
  webben efter omläggningen.
- **Spegla inte parkerade/dolda webbkoncept** (Dashboard, rapporter, AI-motorer) i Go.
  Fält-appen ska hålla sig till utförande-flödet: dagens jobb, order, utförande,
  material, tidrapport, dagrapport.
- Nya planeringsbegrepp — "Grovplanering" (master: skapad→fakturerad) och
  "Veckoplanering" (fin: 168h-schema per team) — är **planerarens** ytor. Go behöver dem
  inte; om Go visar planeringsrelaterad text bör den vara konsekvent med terminologin.

---

## 10. Status på de 8 kända avvikelserna (`api-match-report.md`)

Backend är **oförändrad** för de 8 punkterna — de gäller fortfarande. Snabb påminnelse:

- **Kategori A (rena namnbyten i appen, enradare):**
  #1 `app/config` → `app-config`; #2 `user/preferences` → `preferences` (läs
  `data.preferences`); #3 `notifications/unread-count` → `notifications/count`
  (läs `data.unreadCount`).
- **Kategori B (kräver beslut — bygg i backend eller peka om appen):**
  #4 GPS-batch, #5 async ruttoptimering vs synkron `route-optimized`, #6 röstkommando
  vs `ai/transcribe`, #7 AI-stream vs `ai/chat`, #8 `route-metrics/today`.

**Tillägg sedan den rapporten:** `metadata-context` exponerar nu **även**
antals-endpoints (`quantity-update`, `taken-quantity-update`) utöver det som
api-match-report listade som "bonus" (`metadata-context`/`metadata-update`,
`terminology`). Rör **inte** `/api/v1/`-omskrivningen — den är fortsatt korrekt.

---

## 11. Beslutspunkter för Mats

1. **Antal i fält — går vi live i Go nu?** Backend är klart. Ska Go bygga in
   antals-/taget-antal-UI i nästa release, eller vänta?
2. **Områdesfilter (§3.2):** behöver fält-appen område-indelning/filter på metadata? Om
   ja → additiv backend-ändring (lägg `area` på `metadata-context`-raderna). Om nej →
   webb-only, Go hoppar över det.
3. **Utförandekoder/ikoner (§8):** exponera registret på `/api/mobile/*` för riktiga
   etiketter/ikoner, eller nöja oss med kort kod i fält?
4. **Kategori B-avvikelserna (#4–#8):** för varje — bygga endpoint i backend, eller
   peka om appen till befintlig (enklast/billigast)? Rekommendationen i api-match-report
   är "peka om appen" för alla utom om kö/stream verkligen behövs.
5. **Dokumentationsstädning:** ska handbokens §9 (antal) och §6 (två metadata-system)
   uppdateras/tas bort nu när de är inaktuella? (Rekommenderas — annars fortsätter de
   vilseleda.)

---

## 12. Prioriterad checklista för Go-teamet

### Måste (fakturaintegritet + korrekt fältdata)
- [ ] Ta bort antaganden om att "antal inte kan ändras i fält" (handbok §9).
- [ ] Implementera antals-UI via `metadata-context`: visa redigerbart fält **endast**
      vid `editableQuantity=true`, dölj vid `hideQuantityInApp=true`, read-only vid
      fakturalås. Skriv via `quantity-update`.
- [ ] Lita **enbart** på mobil-order-endpoints (work_orders-härledda); ingen egen
      koncept-/avropshämtning (§4).
- [ ] Klarmarkera via `PATCH /api/mobile/orders/:id/status` med `status:"utford"` —
      servern sätter statusfälten och kör obligatorisk-kontrollen (§6).
- [ ] Skicka in obligatoriska `leaveMetadataFields` vid klarmarkering (400-flödet); undvik
      offline-sync-vägen för slutförande om det gate:t måste gälla (§6).

### Bör (rätt fältupplevelse)
- [ ] Registrera "taget antal" via `taken-quantity-update` (svinn/retur).
- [ ] Gruppera metadata på `groupField`; skicka barnets `metadataField` vid skrivning.
- [ ] Behandla systemgenererade/härledda metadatavärden som read-only (§3.3).
- [ ] Hämta terminologi/etiketter från `GET /api/mobile/terminology`; hårdkoda inte (§9).
- [ ] Kommunicera fakturastatus korrekt ("utförd ≠ fakturerad").
- [ ] Åtgärda Kategori A-namnbytena (#1–#3) — enradare.

### Kan (efter beslut)
- [ ] Område-gruppering/filter i fält (kräver `area` på `metadata-context`) — §3.2/§11.
- [ ] Kategori B (#4–#8) enligt beslut i §11.
- [ ] Utförandekoder/ikoner enligt beslut i §11.

---

*Rapport verifierad mot `server/routes/mobile/*` 2026-07-08. Vid framtida ändringar i
mobil-ytan — uppdatera denna rapport och de refererade dokumenten så att Traivo One och
Traivo Go hålls i synk. Referensimplementation: `client/src/components/SimpleFieldApp.tsx`.*
