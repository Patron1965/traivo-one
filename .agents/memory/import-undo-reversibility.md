---
name: Reversibel import (Ångra-funktion) — stämplingsordning & atomicitet
description: Hur import_actions måste stämplas så att ingen mutation blir oåterställbar, och varför metadata-batchskrivaren inte får transaktions-wrappas.
---

# Reversibel import — undo-ledger & atomicitet

`import_actions` är en undo-ledger: en rad per reversibel mutation under en
import-batch. Undo backar senaste reversibla batchen inom ett tidsfönster
(admin-gated), men bara om nuvarande state fortfarande matchar `afterJson`.

## Regel 1: Stämpla FÖRE den fel-benägna mutationen, inte efter
Om åtgärds-raden stämplas EFTER mutationen kan ett kast/krasch i mellanrummet
lämna en mutation utan undo-rad → oåterställbar. Ordna alltid: stämpla → mutera.
- **create_object:** stämpla efter att objektet + payer skapats men FÖRE
  metadata-skrivningen. Undo soft-deletear objektet, vilket automatiskt döljer
  dess metadata → ingen separat metadata-undo behövs på create-vägen.
- **update_object:** stämpla scalar-snapshot (beforeJson) DIREKT efter scalar-UPDATE
  och FÖRE parent-sync/payer/metadata.

## Regel 2: Best-effort batch-skrivare får INTE wrappas i db.transaction
`writeObjectImportMetadataBatch` är medvetet best-effort: vid batch-insert-fel
faller den tillbaka till en-rad-i-taget i ett catch-block. I en PG-transaktion
avbryts hela transaktionen vid första felande sats ("current transaction is
aborted") → per-rad-fallbacken dör. Därför går det INTE att göra
metadata-skrivning + undo-stämpel atomiska via en omslutande transaktion.

**Mönstret istället (pre-stamp + finalize + baseline-recovery):**
1. PRE-stämpla `metadata_write` FÖRE skrivningen med `beforeJson.baseline` =
   objektets befintliga metadata-id:n och `afterJson.ids = null` (= ej finaliserad).
2. Kör best-effort-skrivaren (returnerar void; skriver 0..N rader).
3. Diffa nya id:n och UPDATE:a åtgärdens `afterJson.ids` (exakt finalisering).
4. Undo: om `ids` är en array → radera exakt dem; om `ids` saknas (krasch i
   fönstret efter skrivning) → recovery: radera objektets nuvarande metadata som
   INTE finns i baseline. Recovery kan över-radera men är bounded (senaste batch,
   admin, inom fönstret).

**Why:** kostade flera review-rundor att inse att transaktions-wrapping bröt
skrivarens fallback-semantik; pre-stamp+finalize är den enda korrekta vägen som
lämnar skrivaren orörd.

**How to apply:** Vid nya reversibla import-mutationer — stämpla före mutationen;
för metadata som måste diffas i efterhand, använd pre-stamp+finalize istället för
att stämpla efter skrivningen.
