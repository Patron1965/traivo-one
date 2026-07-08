---
name: Informationspaket 94-fälts-avstämning
description: Kontraktets grupperade vy vs CSV:ns 94 atomära fält; hur avstämningen och status-taggarna hänger ihop.
---

# Informationspaket: 94-fälts-avstämning

Kundens informationspaket-CSV (`attached_assets/Upgiftslogic_*.csv`, fältrubrik-rad =
rad 4 vid `;`-parsning) innehåller **exakt 94 atomära fält**. Naiv `;`-split ger 95 —
kolumn 88–89 är två halvor av ETT citerat fält (uppgiftsstatus inkl. "Överbokad").
Korrekt CSV-parsning → 94.

## Två vyer av samma sanning
- **Kontraktets grupperade vy** (`INFORMATIONSPAKET_FALT` i `shared/uppgift-contract.ts`)
  buntar ihop atomära fält till ~42 rader (t.ex. "Pris · kostnader · påslag · fast pris").
  Det är avsiktligt, inte en lucka.
- **94-fälts-rapporten** (`docs/informationspaket-94-falt-avstamning.md`) listar varje
  atomärt fält 1:1 mot CSV: fält → källa → hur (D/M/S/SYS) → backing → status.

**Why:** Mats (PO) läser CSV atomärt och tolkar hopbuntningen som att fält "saknas".
Håll båda vyerna — bunta i kontraktet, atomärt i rapporten.

## Status-taxonomi
`FaltStatus = finns | harleds | delvis | saknas | motor_kvar` (valfritt `status?` på
`InformationspaketFalt`; utelämnad = "finns"). Rapport-tally: 80 finns / 1 härleds /
11 delvis / 2 saknas = 94.

- Äkta luckor (saknas): objektets Pos Z 3D-höjd, objektets yta/sträcka.
- "Överbokad" = **hopbuntad i rapporten** (ryms i fält 88 = delvis, därför 2 saknas) men
  **atomär i kontraktet** med `status:"saknas"` (statusvärdet finns ej i
  `deriveUppgiftStatus()`). Samma lucka, två räkningar — inte en motsägelse.

## Säkert att utöka additivt
`INFORMATIONSPAKET_FALT` har **inga kod-konsumenter** (endast docs/adr refererar
katalogen) → nya entries/status-fält bryter inget. `deriveUppgiftStatus()` är den enda
status-mappningen och är orörd.

**How to apply:** När kundens fältlista ändras, uppdatera BÅDE rapporten (atomärt) och
kontraktet (grupperat + ev. atomär status-rad). Verifiera CSV-fältantal med riktig
CSV-parser, aldrig rå `;`-split.
