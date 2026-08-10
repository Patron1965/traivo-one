---
name: Uppgiftspaketet (arbetskopia)
description: Regler för uppgiftspaket-jsonb på work_orders/assignments — fyllnad, propagering, frozen-gate, spegelsynk.
---

# Uppgiftspaketet (arbetskopian)

Nullable jsonb `uppgiftspaket` på BÅDE `work_orders` och `assignments` är uppgiftens operativa arbetskopia (kund, antal, artikel, åtkomst, primär/sekundär position, tidsfönster). Kontraktet bor i `shared/uppgift-contract.ts`, byggd/propagerad via `server/services/uppgiftspaket.ts` — motorer ska läsa paketet, inte objektet.

**Regler:**
- **Frozen-gate går ALLTID via `deriveUppgiftStatus()` + `isUppgiftFrozen()`** — fryst = utford och senare (inkl. terminala lägen). Propagering rör ALDRIG frysta uppgifter. Inför aldrig en parallell status-mappning.
- **Paketfyllnad är obligatorisk:** ett paketfel avbryter uppgiftsskapandet högljutt — svälj aldrig fyllnadsfel tyst; nya skapandevägar får inte återinföra `.catch(→undefined)`-mönstret.
- **Artikel-snapshot är fryst skapandefakta:** paketets artikeldel fryses atomärt i samma transaktion som uppgiften/raden skapas (första artikeln vinner via CAS på jsonb-fältet). Registeruppslag efter skapandet är förbjudet — propagering och backfill måste bevara befintliga snapshotfält, aldrig bygga om dem från dagens register/rader.
- **Geografi:** primär körbar plats kommer från objektets platsmodell, sekundär utförandeplats från Geografi-metadatat (aldrig ruttbar). Spegelsynk till mirror-kolumner är present-value-only — nollar aldrig befintliga värden.
- **Propagering trunkeras ALDRIG:** subträds-expansionen är uttömmande (loud warn vid mycket stora subträd, chunkade IN-listor). En tyst cap bröt kravet "alla öppna/framtida uppgifter" och underkändes i review.

**Why:** arbetskopian ska vara fryst fakta efter utförande (fakturaunderlag) men levande spegel av objektets metadata innan dess; två tabeller = samma kontrakt, samma gate.

**How to apply:** vid nya skapandevägar, nya statusar eller ändrad geografimodell — gå via kontraktet och servicen, aldrig egna kopior; skala via chunkning/varningar, aldrig tyst trunkering.
