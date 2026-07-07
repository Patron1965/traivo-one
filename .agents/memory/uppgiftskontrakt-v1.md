---
name: Uppgiftskontrakt v1 (P2 låst modell)
description: De låsta besluten för gemensam uppgiftsmodell, informationspaket och status-som-ett-fält. Framtida P3/P4/P5-bygge måste vara konsistent med dessa.
---

Låst i P2 ("Lås modellen"). Kontrakt = `docs/adr-uppgiftskontrakt-v1.md` +
`shared/uppgift-contract.ts` (additivt, noll anropare, expand-contract). Strategi
speglar P1: logiskt kontrakt nu, fysisk konsolidering/motorer/migration i P3+.

## Status = ETT fält (#19)
- Kanonisk användarstatus härleds via `deriveUppgiftStatus()` — den är ENDA
  platsen mappningen får definieras. De fysiska kolumnerna (`orderStatus`,
  `executionStatus`, `invoiceQueueState`) ändras INTE; "två axlar" blir interna.
- **Why:** grundmodellen kräver EN status utan mellanlägen; koden har fragmenterad
  status → presentation-enad nu, fysisk merge senare.
- **Produktägarbeslut 2026-07-07:** `skapad` = bara skapandeögonblick, durabelt
  ENDAST för uppskjutet avrop/abonnemang som väntar på trigger (normala uppgifter
  går direkt till `i_masterplanering`). `fakturakontroll` = fakturagranskning/kö
  (kopplas till fakturakön held/pending/consolidated + exec `inspected`), INTE
  fysisk besiktning. `avbruten` ÄR egen status. `planerad` har interna dellägen
  (planerad_resurs/las, planned_fine) → ETT värde.

## Informationspaket = två axlar (#8)
- `INFORMATIONSPAKET_FALT` (shared) = enda källan. Håll axlarna åtskilda:
  KÄLLA (`artikel|orderkoncept|objekt|system`) × HÄMTNINGSSÄTT (`D`=ren data,
  `M`=metadata-styrt, `S`=sidoregister, `SYS`=systemsatt/motorer). Ett fält kan
  ha flera hämtningssätt.
- **Fälla:** P1:s `client/src/lib/metadata-kalla.tsx` använder D/M/S/SYS som
  KÄLL-etiketter (D=artikel, M=objekt, S=orderkoncept) och blandar ihop axlarna.
  Kontraktet använder grundmodellens betydelse ovan; P1-relabel = liten separat
  uppföljning (ej gjord i P2).

## Gemensam uppgiftsmodell (#5)
- EN logisk Uppgift över TVÅ fysiska tabeller (`assignments` pre-materialiserat +
  `work_orders` materialiserat), idag löst korrelerade (objectId+customerId+
  orderConceptId) UTAN FK. `uppgiftId` = work_orders.id efter materialisering
  annars assignments.id.
- **P3-bygge (ej P2):** nullable `work_orders.assignmentId`-FK; alla fyra skapare
  landar i registret; felanmälan/rating skapar uppgift DIREKT vid händelsen
  (produktägarbeslut, ej manuell grind); varje uppgift = en artikel (admin/
  påminnelse → `taskCategory="admin"`).
- **Trigger-gap-fälla:** `deriveUppgiftStatus` tar `awaitingTrigger`/`materialized`
  men de har INGEN egen kolumn idag. P3 måste härleda på EN plats: `materialized`
  = korrelerad work_order finns (FK satt); `awaitingTrigger` = uppskjuten skapare
  vars trigger ej inträffat. Sprid ut = just den fragmentering kontraktet stoppar.

## Öppet/parkerat
- Fakturalås-enhet vid 1 koncept→flera fakturor (deferras P4-fakturamotor).
- `task_status_events` append-only-logg (bounce/dwell) — parkerad; milstolpe-
  stämplarna är enkelvärda/överskrivs → kan ej räkna återgångar idag.
- Metadata på fakturarad — parkerad.
