# ADR — Uppgiftskontrakt v1 (P2: "Lås modellen")

**Status:** Låst (produktägarbeslut 2026-07-07). Rent designdokument — ingen
kod, inga migrationer i denna fas.
**Datum:** 2026-07-07.
**Fas:** P2 (HÖG) i "allt är metadata"-ombygget (P1 objektsida klar & mergad).
**Föregångare:** `adr-orderkoncept-v3.md` (objekt-neutralitet, kund-hierarki,
fakturanivåer, metadata-livscykel), `docs/uppgiftsmodellen-utredning.md`,
`docs/uppgiftslogik-utvecklingslogg.md`.
**Källmaterial:** `exports/grundmodell.html` (Steg 0), `exports/tasklista.html`
(P1–P5), `.agents/memory/uppgiftslogik-v1-decisions.md`.
**Maskinläsbar motsvarighet:** `shared/uppgift-contract.ts` (enda importbara
källan för P3/P4/P5).

---

## 1. Kontext

Grundmodellen (Steg 0) slår fast tre principer som P4 (de nio motorerna) och
P5 (masterplanering + utförarplan) bygger direkt ovanpå:

1. **Allt som ska göras blir EN uppgift** i uppgiftsregistret — även "ring kund"
   eller en påminnelse. Inget mellanting.
2. **Informationspaketet**: varje uppgift bär ett paket av fält med en **KÄLLA**
   (artikel/orderkoncept/objekt/system) och ett **HÄMTNINGSSÄTT** (D/M/S/SYS).
3. **Status = ETT fält** uppgiften intar — ingen livscykel, inget mellanläge.

Tasklistans instruktion är uttrycklig: *"Beslut (P2) låser datakontrakten som
motorerna (P4) och planeringen (P5) bygger på — bygg dem inte innan besluten är
tagna."* Denna ADR låser besluten. Ingen motor, ingen tabellsammanslagning och
inga statuskolumn-ändringar görs här (se §6 Guardrails).

### 1.1 Nuläget (kodverklighet som kontraktet måste överbrygga)

- **Dubbelt uppgiftslager utan FK.** `assignments` (orderkoncept-expansion /
  planeringslager) och `work_orders` (utförande + fakturering, synligt för
  fält/planner) korreleras idag löst via `objectId + customerId + orderConceptId`.
  Avrops-/abonnemangs-assignments är osynliga för fält/planner tills de
  materialiseras till `work_orders`.
- **Fragmenterad status.** `work_orders.orderStatus` (ORDER_STATUSES: `skapad`,
  `planerad_pre`, `planerad_resurs`, `planerad_las`, `utford`, `fakturerad`,
  `omojlig`, `avbruten`), `work_orders/assignments.executionStatus`
  (EXECUTION_STATUSES: `not_planned`, `planned_rough`, `planned_fine`, `on_way`,
  `on_site`, `completed`, `inspected`, `invoiced`), `work_orders.invoiceQueueState`
  (`pending`/`held`/`consolidated`/`exported`), `assignments.status` (legacy).
  Slutförande-grinden kräver idag BÅDE `orderStatus="utford"` OCH
  `executionStatus="completed"`.
- **Fyra skapare skiljer sig åt:** orderkoncept-expansion → `assignments`
  (admin-artiklar direkt till `work_orders`); snabborder → `work_orders` direkt;
  felanmälan → `public_issue_reports`; rating → `technician_ratings`.

Strategin speglar P1: **logiskt kontrakt nu, fysisk konsolidering senare
(expand-contract).**

---

## 2. Beslut #5 — En gemensam uppgiftsmodell

**Beslut:** Det finns EN logisk "Uppgift". Den backas i v1 av de två fysiska
tabellerna (`assignments` + `work_orders`) via en definierad projektion — INGEN
tabellsammanslagning i P2.

- **Identitet:** `uppgiftId = work_orders.id` efter materialisering, annars
  `assignments.id`. Diskriminator: vilket lager id:t pekar på (`UppgiftRef`).
- **Spårbarhet (P3-bygge):** nullable `work_orders.assignmentId` införs
  (expand-contract) så en materialiserad uppgift kan spåras tillbaka till sin
  assignment. Dagens rena korrelation (objectId+customerId+orderConceptId) är en
  reell defekt och ersätts av FK:n.
- **Materialiserings-/triggerregel (P3-bygge, EN plats):** `deriveUppgiftStatus`
  tar `awaitingTrigger`/`materialized`, men dessa har INGEN egen fysisk kolumn
  idag. P3 MÅSTE härleda dem på ETT ställe: `materialized` = det finns en
  korrelerad `work_orders`-rad (efter FK: `work_orders.assignmentId` satt);
  `awaitingTrigger` = uppskjuten skapare (avrop/abonnemang/schema) vars trigger
  (avropsdatum/abonnemangsperiod) ännu ej inträffat. Sprid aldrig ut denna regel
  — det är precis den fragmentering kontraktet finns för att förhindra.
- **Alla skapare landar i registret (P3-bygge):** orderkoncept, snabborder,
  felanmälan, rating och metadatabevakning mynnar i samma register.
- **En uppgift = en artikel:** varje uppgift bär en artikel. Admin-/
  påminnelseuppgifter ("ring kund") backas av **admin-artiklar**
  (`taskCategory="admin"`). Produktion/resa/ställtid/egentid är uppgiftstyper
  (olika utförandekod), i linje med utvecklingsloggen.

**Produktägarbeslut 2026-07-07:** felanmälan/rating skapar en uppgift **direkt
vid händelsen** (grundmodellens "inget mellanting") — ingen manuell triage-grind
krävs. (Nuvarande manuella hantering är gapet P3 stänger.)

---

## 3. Beslut #8 — Informationspaketets datakontrakt

**Beslut:** Kontraktet definieras längs TVÅ åtskilda axlar och låses i
`INFORMATIONSPAKET_FALT` (`shared/uppgift-contract.ts`):

| Axel | Betydelse | Värden |
| --- | --- | --- |
| **KÄLLA** (`kalla`) | Varifrån fältet härstammar (kortets rubrik) | `artikel` · `orderkoncept` · `objekt` · `system` |
| **HÄMTNINGSSÄTT** (`hamtning`) | HUR fältet fylls (badgen) | `D`=ren data · `M`=metadata-styrt · `S`=sidoregister · `SYS`=systemsatt (motorer) |

- Ett fält kan ha **flera** hämtningssätt (t.ex. "Kund · betalare" = D + M).
- Grundregel (grundmodell §3): **alla** datafält på artikeln OCH orderkonceptet
  ska återfinnas i paketet, plus objekt-metadata och motorernas SYS-fält.
- Varje fält får dessutom en `storage`-etikett (`column` / `live-compute` /
  `engine-output` / `sidoregister`) + `backing` = karta till dagens kod.
- SYS-fälten (position, planerad tid, klump, fakturagruppering, abonnemang,
  beroende-ordning, status) **levereras av P4-motorerna**; de är kontrakterade
  som placeholders nu, ej byggda.

**Uppföljning (P1-relabel, EJ P2):** `client/src/lib/metadata-kalla.tsx` använder
D/M/S/SYS som *käll*-etiketter (D=artikel, M=objekt, S=orderkoncept, SYS=system)
och blandar därmed ihop de två axlarna. Grundmodellens kanoniska betydelse ovan
gäller i kontraktet; ometikettering av P1-UI är en liten separat uppföljning.

---

## 4. Beslut #19 — Status som ETT fält

**Beslut:** EN kanonisk, ordnad, användarvänd status (`UPPGIFT_STATUSES`), härledd
från de fysiska kolumnerna via den rena funktionen `deriveUppgiftStatus()`. Den
tidigare utredningens "två axlar" (execution vs affär) blir **interna** kolumner;
användaren ser ETT värde. Ingen fysisk statuskolumn ändras i P2.

**Kanoniska värden:**
`skapad` → `i_masterplanering` → `planerad` → `pa_vag` → `pa_plats` → `utford`
→ `fakturakontroll` → `fakturerad`, plus `omojlig_att_utfora` och `avbruten`.

**Härledning (precedens uppifrån):**

| Kanonisk status | Härleds från |
| --- | --- |
| `avbruten` | `orderStatus="avbruten"` |
| `omojlig_att_utfora` | `orderStatus="omojlig"` eller `impossibleReason` satt |
| `fakturerad` | `orderStatus="fakturerad"` / `executionStatus="invoiced"` / `invoiceQueueState="exported"` |
| `fakturakontroll` | `executionStatus="inspected"` **eller** (utförd + `invoiceQueueState` ∈ {pending, held, consolidated}) |
| `utford` | `executionStatus="completed"` eller `orderStatus="utford"` |
| `pa_plats` | `executionStatus="on_site"` |
| `pa_vag` | `executionStatus="on_way"` |
| `planerad` | `executionStatus="planned_fine"` / `orderStatus` ∈ {planerad_resurs, planerad_las} |
| `skapad` | uppskjutet avrop/abonnemang som väntar på trigger (ej materialiserat) |
| `i_masterplanering` | allt övrigt (nyskapat, not_planned, planned_rough, planerad_pre) |

**Produktägarbeslut 2026-07-07:**
- **`skapad`** är bara skapandeögonblicket; normala uppgifter hamnar **direkt** i
  masterplanering. `skapad` är durabelt ENDAST för uppskjutna avrop/abonnemang.
- **`fakturakontroll`** = fakturagranskning/kö (utförd väntar på fakturering,
  kopplas till fakturakön), INTE en separat fysisk besiktning. `inspected` faller
  in här.
- **`avbruten`** ÄR en egen kanonisk status vid sidan av `omojlig_att_utfora`.
- **`planerad`** har interna dellägen (`planerad_resurs`/`planerad_las` resp.
  `planned_fine`) som alla mappar till det ENA värdet `planerad`.

**Ännu ej uttryckbart (medvetet parkerat):** återgångar/bounce-räkning
(finplanering↔masterplanering) och dwell-tid kräver en append-only
`task_status_events`-logg (utvecklingslogg §4 U8). Milstolpe-tidsstämplarna på
`work_orders`/`assignments` är enkelvärda och skrivs över → kan inte räkna
bounces. Kontraktet lämnar detta parkerat.

---

## 5. Öppna frågor (kvarstår efter P2)

- **Fakturalås-enhet:** när ETT orderkoncept skapar FLERA fakturor — vad utgör
  "allt klart"-enheten (hela ordern vs per faktura-referens/objekt)? Bärs i
  paketet som fältet "Fakturalås · fakturabroms". Deferras till P4 (fakturamotor).
- **`task_status_events`-logg** (bounce/dwell/genomloppstid): parkerad, byggs
  efter P4/P5 enligt utvecklingsloggen.
- **Metadata på fakturarad:** parkerad (utvecklingslogg).

---

## 6. Guardrails — vad P2 uttryckligen INTE gör

Inga migrationer · ingen tabellsammanslagning (assignments/work_orders behålls)
· inga statuskolumn-ändringar · ingen motorkod · ingen backfill · ingen
runtime-validering/enforcement · ingen ombyggnad av P1-UI. Leveransen är detta
dokument + den additiva `shared/uppgift-contract.ts` (noll ändrade anropare).

---

## 7. Nedströms (implementeras EFTER P2)

- **P3 (uppgiftsflöde):** koppla de fyra skaparna till registret (#6); avrop →
  riktig uppgift (#7); `work_orders.assignmentId`-FK; felanmälan/rating skapar
  uppgift direkt; flytta statushärledningen till `deriveUppgiftStatus()`.
- **P4 (nio motorer):** fyll SYS-fälten enligt `INFORMATIONSPAKET_FALT`.
- **P5 (planering):** status sök-/sorterbar i masterplaneringen (#20) via den
  kanoniska statusen; filterregister (#21); utförarplan/vecka (#22).
