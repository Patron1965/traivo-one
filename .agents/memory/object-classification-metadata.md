---
name: Objektklassificering som metadata
description: Objektets typ/nivå: metadata är ENDA källan — legacy-kolumnerna är droppade (contract-fasen klar).
---

Beslut: klassificeringen (katalogfälten Objekttyp/Anläggningstyp, systemområde Klassificering, ärvs aldrig) är ENDA källan för objektets typ/nivå. Kolumnerna `objects.object_type/hierarchy_level/object_level` (+ döda `article_id`/`last_service_date`) är DROPPADE (idempotent migration i post-merge-replay). Ingen fallback finns kvar.

**Why:** "Allt är metadata" — två aktiva källor drev drift; contract-fasen genomförd 2026-08-10 efter verifierad backfill.

**How to apply:**
- Läs klassificering via `server/services/object-classification.ts`: `getObjectHookClassification(tenantId, objectId)` (enstaka) eller `getClassificationForObjects(tenantId, ids)` (batch-Map).
- I list-/filter-SQL: `objectOwnMetadataTextValueSql(fieldName)` / `...SqlFor(fieldName, idRef)` i `server/services/object-metadata-sql.ts` (icke-ärvande correlated subquery).
- Skrivvägar som förr satte kolumnerna använder `scheduleClassificationMirror`/`mirrorClassificationToMetadata` (skriver auto-rader; manuella rader vinner alltid; tx-säker uppskjuten poll).
- Objektkopiering behöver INGEN extra spegling — klassificeringen följer med metadata-kopian.
- Barn-först-ordning vid radering: sortera på `hierarchyDepth` (objectLevel finns ej).
- Prod: kolumnerna droppas först via Publish; katalogfälten etableras av `ensureSystemomradenFalt` vid startup (prod saknade fälten före publish — 19 icke-default demo-värden snapshotade i `docs/legacy-objektfalt-rivning-1486.md`).
