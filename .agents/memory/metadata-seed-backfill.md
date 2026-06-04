---
name: Metadata-katalog seed är insert-only — flagg-ändringar kräver backfill
description: Ändring av flaggor i STANDARD_METADATA_DEFINITIONS (kronologiskVisning m.fl.) når aldrig befintliga tenants utan explicit idempotent backfill i seedDefaultMetadataTypes.
---

`seedDefaultMetadataTypes(tenantId)` i `server/metadata-queries.ts` matchar på
`metadataKatalog.namn` (lowercase) och **insertar bara saknade** definitioner —
befintliga rader hoppas över helt. Att ändra en flagga på en redan-seedad
definition i `STANDARD_METADATA_DEFINITIONS` (t.ex. sätta `kronologiskVisning: true`
på "Senaste felanmälan"/"Senaste kundbetyg") påverkar därför **bara helt nya
tenants** om man inte också lägger till en idempotent backfill-UPDATE.

**Why:** Alla aktiva tenants (inkl. KINAB) har redan kört seed en gång; deras rader
finns. Utan backfill blir kod och DB osynkade och felsökning blir förvirrande
("jag ändrade ju definitionen men beteendet ändras inte").

**How to apply:** När du ändrar ett *fält/flagga* (ej bara lägger till nytt namn) i
`STANDARD_METADATA_DEFINITIONS`, lägg till en idempotent UPDATE i
`seedDefaultMetadataTypes` som sätter flaggan för de berörda `namn` där den skiljer
sig (`WHERE tenant_id = ... AND namn IN (...) AND flagga = false`). Seed körs vid
varje uppstart, så det blir self-healing. Detta gäller bara det svenska
metadata-systemet (`metadataKatalog`); se `dual-metadata-systems.md`.
