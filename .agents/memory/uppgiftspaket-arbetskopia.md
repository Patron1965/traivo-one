---
name: Uppgiftspaketet (arbetskopia)
description: Regler för uppgiftspaket-jsonb på work_orders/assignments — fyllnad, propagering, frozen-gate, spegelsynk.
---

# Uppgiftspaketet (arbetskopian)

Nullable jsonb `uppgiftspaket` på BÅDE `work_orders` och `assignments` är uppgiftens operativa arbetskopia (kund, antal, artikel, åtkomst, primär/sekundär position, tidsfönster). Kontraktet bor i `shared/uppgift-contract.ts`, byggd/propagerad via `server/services/uppgiftspaket.ts` — motorer ska läsa paketet, inte objektet.

**Regler:**
- **Frozen-gate går ALLTID via `deriveUppgiftStatus()` + `isUppgiftFrozen()`** — fryst = utford och senare (inkl. terminala lägen). Propagering rör ALDRIG frysta uppgifter. Inför aldrig en parallell status-mappning.
- **Varje ny skapandeväg för uppgifter MÅSTE fylla paketet — OBLIGATORISKT (paket v2):** paketfyllnad kastar vid fel (skapandet avbryts högljutt), aldrig tyst svälj. Storage-hooks täcker de vanliga vägarna; routes som gör direkta inserts måste fylla själva utan `.catch(→undefined)`.
- **Artikel-snapshot (v2):** paketets `artikel` fryser register-/radvärden (id/nr/namn/pris/kostnad/produktionstid/debiteringsmodell) vid skapandet. Första artikelbärande orderrad/assignment-artikel stämplar snapshoten via CAS-update (skriv endast om `artikelId` saknas i jsonb) — skydd mot samtidiga första-rader. Propagering måste SPREADA prev-snapshoten och bara uppdatera koderna, annars raderas frysta fält. Registeruppslag sker ALDRIG efter skapandet.
- **Geografi:** primär körbar plats kommer från objektets platsmodell, sekundär utförandeplats från Geografi-metadatat (aldrig ruttbar). Spegelsynk till mirror-kolumner är present-value-only — nollar aldrig befintliga värden.
- **Propagering trunkeras ALDRIG:** subträds-expansionen är uttömmande (loud warn vid mycket stora subträd, chunkade IN-listor). En tyst cap bröt kravet "alla öppna/framtida uppgifter" och underkändes i review.

**Why:** arbetskopian ska vara fryst fakta efter utförande (fakturaunderlag) men levande spegel av objektets metadata innan dess; två tabeller = samma kontrakt, samma gate.

**How to apply:** vid nya skapandevägar, nya statusar eller ändrad geografimodell — gå via kontraktet och servicen, aldrig egna kopior; skala via chunkning/varningar, aldrig tyst trunkering.
