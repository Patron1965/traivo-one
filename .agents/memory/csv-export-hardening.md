---
name: CSV-export hardening
description: Regel för att neutralisera formula-injection (CWE-1236) i alla CSV-exporter.
---

Alla CSV-export-endpoints (`Content-Type: text/csv`) måste skydda mot Excel/Google Sheets formula injection.

**Regel:** Innan en cell citeras, prefixa en apostrof (`'`) om värdet börjar med `=`, `+`, `-`, `@`, TAB eller CR. Apostrofen visas inte i kalkylprogrammet men förhindrar att cellen tolkas som en formel.

**Why:** Code review (2026-05-27) hittade att `csvEscape` i exportflödet bara escapade `"`, `,`, `\n`, `\r`. Ett artikelnamn som börjar med `=` exporteras → admin öppnar i Excel → formel exekveras med admins rättigheter (kan göra HTTP-anrop till extern host, hämta lokala filer i äldre Excel-versioner, etc).

**How to apply:** Lägg in checken som första steg i `csvEscape`-helpern *innan* citeringen. Mönstret som finns i `server/routes/configRoutes.ts` (csvEscape + rowsToCsv) är referensimplementation — använd det när du lägger till nya CSV-exporter (t.ex. för kunder, objekt, work-orders) istället för att skriva en egen escaper.
