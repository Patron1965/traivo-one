---
name: allowed_values sväljer import-metadata tyst
description: Varför korrekt mappade importkolumner ändå kan ge noll metadata_varden, och hur backfill från sparade sessioner görs
---

# allowed_values-gate:n sväljer importvärden tyst

Batch-skrivaren för import-metadata (`writeObjectImportMetadataBatch` →
`coerceImportBatchVarde`) hoppar över ogiltiga värden UTAN varning. Ett
katalogfält med `allowed_values` som inte täcker filens faktiska värden ger
därför noll skrivningar trots att kolumnen är korrekt mappad — importresultatet
ser lyckat ut.

**Why:** Kinab-prod: "Objekt typ" var mappad till fältet Typ, men Typ hade
allowed_values (Kärl/Miljörum/…) som inte innehöll filens värden
(Butik/Pantkärl/Matavfallskärl/…) → 0 av 892 värden skrevs, helt tyst.

**How to apply:**
- Vid "mappad men tom"-symptom: kontrollera katalogfältets `allowed_values`
  (och `ar_beraknad`, nivå-lås) före djupare felsökning.
- Backfill behöver ingen kundfil: `object_import_sessions.raw_rows` i prod
  behåller hela källfilen; matcha objekt via interimsnummer-metadatat.
  Mönster: `scripts/backfill-kinab-import-metadata.ts` (dry-run default,
  dubbel confirm, en tx, skip-om-aktivt-värde = idempotent, historik +
  import_batch_id stämplas).
- Utöka allowed_values (union) i samma körning innan värdena skrivs.
