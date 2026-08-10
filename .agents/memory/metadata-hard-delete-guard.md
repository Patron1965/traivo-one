---
name: Metadata hård-raderingsspärr gäller ALLA vägar
description: Alla kodvägar som hård-raderar metadata_varden måste gå via deleteMetadataGuarded eller ha egen historik-blocker — inkl. objekt-radering.
---

Regeln: ett metadata-värde med verklig historik (`metadata_historik.gammalt_varde IS NOT NULL`) eller konceptkopplingar får aldrig hård-raderas via någon användarexponerad väg — svara 409 USE_ARCHIVE eller arkivera (mjuk-radera) istället.

**Why:** Spärren fanns först bara på `DELETE /api/metadata/:id`; kompat-API:t (`/api/objects/:objectId/metadata/:id`), what3words-tömning och objekt-hård-radering (enkel + bulk i `object-archive.ts`, som raderar metadata_varden + metadata_historik i svep) kringgick den.

**How to apply:**
- Nya delete-vägar för värden: använd `deleteMetadataGuarded` (atomisk FOR UPDATE-check). "Töm fält"-UX vid blocked → fall tillbaka till `softDeleteObjectMetadata`.
- Objekt-hård-radering: `deleteObjectPreflight`/`bulkDeleteObjects` räknar metadatahistorik (gammalt_varde IS NOT NULL) som blocker — lägg samma räkning i nya bulk-/raderingsvägar.
- Medvetet undantagna: `rollbackDeleteMetadataRows` (import-ångra/enrich-restore), tombstone-rader utan värde, WO-metadata (skriver aldrig historik).
