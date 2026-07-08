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
handbok skrevs (23 juni). De viktigaste sakerna som chaufförsappen behöver anpassa
sig efter:

1. **Antal går nu att redigera i fält.** Handboken sa "antal går inte att ändra i
   fält" — det stämmer inte längre. Systemet stödjer nu att chauffören justerar antal
   och registrerar "taget/förbrukat antal" (det som styr svinn och retur till lager).
   Go bör visa **en enkel antals-ruta per rad** och låta servern bestämma när den får
   redigeras — inte bygga egen logik.
2. **Metadata visas och fylls i grupperat.** Fält som hör ihop (t.ex. allt under
   "Kontakt") kommer nu färdiggrupperade från servern. Go ska visa dem under sin rubrik
   i stället för som en lång platt lista.
3. **"Utförd" betyder inte "fakturerad".** Ett jobb kan vara klart i fält men ändå
   inte gå till faktura (fryst pris, faktureringsbroms, samlingsfaktura). Go måste
   säga rätt sak i appen.
4. **Utförandekoder/ikoner finns nu som register i webben**, men mobil-ytan skickar
   bara en enkel kod-text. Här finns ett **beslut** att ta (se §7).

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
- **Fakturalås = allt låst.** När ordern är `consolidated`/`exported` blir både
  `editableQuantity` och `takenQuantityEditable` `false`. Rita då read-only. *Varför:*
  fakturaintegritet — servern avvisar annars med fel.

---

## 3. NYTT/UTÖKAT: Visa & lämna metadata i fält (område/familj-gruppering)

`metadata-context` returnerar nu även `showMetadataFields[]` och
`leaveMetadataFields[]` — den nya modellen för "visa aktuellt metadatavärde" resp.
"lämna in ett nytt värde vid utförande".

**Grupp-expansion (nytt):** Varje rad bär `groupField`. När en artikel pekar på ett
**grupp-/familjefält** (t.ex. "Kontakt") expanderar servern det till dess barnfält
**före** värdeuppslag — grupp-föräldern bär aldrig ett eget värde. `groupField` är
förälderns namn så att appen kan **gruppera barnen visuellt under en rubrik**.

| `showMetadataFields[]` | `leaveMetadataFields[]` |
|---|---|
| `articleId`, `articleName`, `metadataField`, `groupField` | `articleId`, `articleName`, `metadataField`, `groupField` |
| `clarification`, `canUpdate` | `instruction`, `required` |
| `currentValue`, `displayValue` | `currentValue`, `displayValue` |

**Skriv tillbaka:** `POST /api/mobile/tasks/:id/metadata-update` —
`{ articleId, metadataLabel, newValue, inspectionStatus?, inspectionComment?, inspectionPhoto? }`.

### Vad Go ska förenkla/anpassa — och varför
- **Gruppera på `groupField`.** Rendera barnfält under en rubrik med förälderns namn i
  stället för en lång platt lista. *Varför:* det speglar hur fälten är tänkta att fyllas i.
- **Skicka alltid barnets `metadataField`, aldrig förälderns.** Grupp-föräldern har
  inget värde och skrivningen avvisas (IDOR-skydd: fältet måste vara konfigurerat som
  uppdaterbart på någon av orderns artiklar).
- **Obligatoriska `leaveMetadataFields` (`required=true`) blockerar klarmarkering.**
  Statusbytet till "utförd" returnerar 400 med en lista över saknade fält (se handbokens
  leaveMetadata-400-flöde) — samla in dem först och skicka `leaveMetadataValues` i
  status-anropet.
- **Metadata-systemet är numera enbart det svenska** (`metadata_katalog`/`_varden`/
  `_historik`). *Varför:* handbokens §6-varning om "två parallella metadata-system
  (engelskt + svenskt)" är **inaktuell** — det engelska systemet är borttaget. Ni
  behöver inte längre bekymra er om vilket system en endpoint träffar; mobil-ytan
  skriver alltid det svenska via rätt värde-ursprung.

---

## 4. Order/artikel-fält från v2 (recap — fortfarande giltigt)

Detaljerna finns i `integration-rapport.md §3` och `v2-handover.md`. Kort:
`GET /api/mobile/v2/orders/:id` bär `frozen.*`, `bomChecklist`, `dependencyStatus`/
`canStart`/`blockedBy`, samt föruppgifter (`isPreTask`/`parentWorkOrderId`).
`articles[]` bär (v1+v2) `files`, `reportingType`, `reportingMetadataField`,
`shouldBeReturned`, `productionTimeMinutes`/`productionTimeSource`.
**Ingen ändring sedan dess — ta med det som redan planerat.**

---

## 5. Utförd ≠ fakturerad + klarmarkering

- **Fakturastatus:** en utförd order kan vara fryst (`frozen.isFrozen`), bromsad
  (`invoiceBrake`) eller köad (`invoiceQueueState` = `held`/`consolidated`/`exported`).
  Go ska **aldrig** anta att "utförd = fakturerad". Visa t.ex. "påverkar inte
  fakturasumma — frusen order" när material/foto läggs till på en fryst order.
- **Klarmarkering — servern sköter statusfälten åt er.** Skicka bara `status:"utford"`
  (eller `"completed"`) till `PATCH /api/mobile/orders/:id/status`. Servern sätter då
  **både** `orderStatus="utford"` och `executionStatus="completed"` och kör
  obligatorisk-kontrollen (obligatoriska `leaveMetadataFields`, 400-flödet i §3).
  Skicka **inget** eget `executionStatus`-fält — det finns ingen sådan parameter.
- **OBS offline-sync-lucka:** klarmarkering via offline-sync (`POST /api/mobile/sync`
  med `status_update`) kör **inte** obligatorisk-kontrollen. Vill ni att 400-flödet för
  obligatoriska fält ska gälla — klarmarkera via PATCH-endpointen när ni är online.

---

## 6. Recap: säkerhetshärdning + orderkoncept-effekter (oförändrat)

Fortfarande giltigt från `integration-rapport.md §2 + §4`:
- **Webb-rutter är låsta bakom `requirePlanner`.** Om Go någonstans råkar anropa
  `/api/checklist*` eller `/api/quick-action` (utan `/mobile`-prefix) → byt till
  **`/api/mobile/*`-varianten** (`POST /api/mobile/quick-action`,
  `GET|POST /api/mobile/orders/:id/checklist`).
- **Orderkoncept-genererade order** kan landa på olika datum (`intervalFlexDays`), ha
  kund härledd per objekt (`customerMetadataField`), och leveransrestriktioner
  (soft/hard). Effekterna syns på ordern; själva koncept-fälten exponeras medvetet
  inte på `/api/mobile/*`.

---

## 7. Utförandekoder & ikoner — LÄGE + BESLUT

**Nuläge i backend:** Traivo One har byggt ett riktigt **utförandekod-register** +
central ikon-renderare (RegistryIcon) i webben. **Men mobil-ytan exponerar bara en
tunn härledning:** `executionCodes` på ordern byggs som
`order.executionCode ? [{ id, code: STORA_4_TECKEN, name: executionCode }] : []` —
alltså rå kod-text, utan register-namn eller ikon.

**Konsekvens för Go:** appen kan visa en kort kod men **kan inte** rendera korrekt
etikett/ikon från registret idag.

> **Beslut som behövs (se §9):** ska vi lägga till en mobil-endpoint som exponerar
> utförandekod-registret (kod → namn + ikon) så att Go kan visa riktiga etiketter/ikoner,
> eller räcker den korta koden i fält?

---

## 8. Status på de 8 kända avvikelserna (`api-match-report.md`)

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
api-match-report listade som "bonus" (`metadata-context`/`metadata-update`). Rör
**inte** `/api/v1/`-omskrivningen — den är fortsatt korrekt.

---

## 9. Beslutspunkter för Mats

1. **Antal i fält — går vi live i Go nu?** Backend är klart. Ska Go bygga in
   antals-/taget-antal-UI i nästa release, eller vänta?
2. **Utförandekoder/ikoner (§7):** exponera registret på `/api/mobile/*` för riktiga
   etiketter/ikoner, eller nöja oss med kort kod i fält?
3. **Kategori B-avvikelserna (#4–#8):** för varje — bygga endpoint i backend, eller
   peka om appen till befintlig (enklast/billigast)? Rekommendationen i api-match-report
   är "peka om appen" för alla utom om kö/stream verkligen behövs.
4. **Dokumentationsstädning:** ska handbokens §9 (antal) och §6 (två metadata-system)
   uppdateras/tas bort nu när de är inaktuella? (Rekommenderas — annars fortsätter de
   vilseleda.)

---

## 10. Prioriterad checklista för Go-teamet

### Måste (fakturaintegritet + korrekt fältdata)
- [ ] Ta bort antaganden om att "antal inte kan ändras i fält" (handbok §9).
- [ ] Implementera antals-UI via `metadata-context`: visa redigerbart fält **endast**
      vid `editableQuantity=true`, dölj vid `hideQuantityInApp=true`, read-only vid
      fakturalås. Skriv via `quantity-update`.
- [ ] Klarmarkera via `PATCH /api/mobile/orders/:id/status` med `status:"utford"` —
      servern sätter statusfälten och kör obligatorisk-kontrollen (§5).
- [ ] Skicka in obligatoriska `leaveMetadataFields` vid klarmarkering (400-flödet); undvik
      offline-sync-vägen för slutförande om det gate:t måste gälla (§5).

### Bör (rätt fältupplevelse)
- [ ] Registrera "taget antal" via `taken-quantity-update` (svinn/retur).
- [ ] Gruppera metadata på `groupField`; skicka barnets `metadataField` vid skrivning.
- [ ] Kommunicera fakturastatus korrekt ("utförd ≠ fakturerad").
- [ ] Åtgärda Kategori A-namnbytena (#1–#3) — enradare.

### Kan (efter beslut)
- [ ] Kategori B (#4–#8) enligt beslut i §9.
- [ ] Utförandekoder/ikoner enligt beslut i §9.

---

*Rapport verifierad mot `server/routes/mobile/*` 2026-07-08. Vid framtida ändringar i
mobil-ytan — uppdatera denna rapport och de refererade dokumenten så att Traivo One och
Traivo Go hålls i synk. Referensimplementation: `client/src/components/SimpleFieldApp.tsx`.*
