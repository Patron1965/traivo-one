---
name: Uppgiftens tidslogg (task_events)
description: Append-only händelselogg per uppgift — designregler för att inte tappa historik eller bryta status-kontraktet.
---

# Uppgiftens tidslogg (task_events, händelselogg)

`task_events` är en fristående, append-only logg per work_order (uppgift), skild
från `audit_logs` (generisk fält-diff). Den fångar uppgift-livscykeln
(önskad→planerad→verklig, studsar grov↔fin, ombokningar) som separata rader.

## Durabla regler
- **Append-only.** En rad skrivs aldrig över; varje övergång = ny rad.
- **Diffa, no-op-tyst.** Loggern loggar BARA verkliga förändringar mellan
  before/after-snapshot av en WO. En oförändrad write ger 0 rader (ingen brus-rad).
- **Kontraktet läses, aldrig omdefinieras.** Kanonisk status via
  `deriveUppgiftStatus` (shared/uppgift-contract.ts). `status_changed` loggas bara
  när härledd status faktiskt ändras. Interna dellägen som mappar till SAMMA
  kontrakts-status (t.ex. planned_rough↔planned_fine = "planerad") syns inte i
  status_changed — de fångas som ett separat "bounce"-event.
- **Verklig tidsstämpel = occurredAt.** För verkliga händelser (på väg / på plats /
  utförd / omöjlig) används den fångade DB-tidsstämpeln, inte now(), annars blir
  tidslinjen fel. Övriga events: occurredAt = now.
- **Best-effort.** Varje anropare wrappar loggen i try/catch — en loggmiss får
  ALDRIG blockera affärsoperationen.
- **Mobil-tenant.** På mobil-ytan härleds tenant ur WO:ns egen tenant, aldrig
  req.tenantId (mobil går utanför tenant-mw).

## Var loggen MÅSTE hakas in (fullständighetskrav)
Varje server-väg som muterar en WO:s livscykel/schema/resurs måste appendera
events, annars blir tidslinjen tyst ofullständig. Detta spänner över minst tre
ytor: webbens WO-uppdatering, mobilens statusbyte, OCH planerarens direkta
ombokning/omschemaläggning. Lägger man en ny skrivväg som inte går via en redan
inhakad `updateWorkOrder`-punkt måste loggen kopplas in explicit där.

## Risk att bevaka
Diffen beror på det låsta kontraktet + specifika verklig-tidsstämpel-kolumner.
Byts kontrakt eller kolumner kan events sluta genereras UTAN att något larmar. Ett
rent enhetstest över diff-fallen (status_changed / bounce / rescheduled / verkliga
stämplar) är enda skyddet mot tyst historikförlust.
