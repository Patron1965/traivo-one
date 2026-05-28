---
name: Metadata-definitioner — soft-delete + livscykelskydd
description: Regler för DELETE/PATCH på metadata_definitions och varför hard-delete är förbjudet (ADR v3 §2.4).
---

# Metadatadefinitioner får aldrig hard-deleteas via API

`metadata_definitions` agerar som kontoplanen i bokföring: så fort en definition har använts (objektvärden, frysta WO-snapshots, koncept-snapshots, aktiva orderkoncept som refererar `fieldKey`) måste den finnas kvar för att historiska värden ska kunna tolkas. `DELETE /api/metadata-definitions/:id` sätter därför bara `deletedAt`. Default-läs filtrerar `deletedAt IS NULL`; `?includeDeleted=true` opt-in.

**Why:** ADR v3 §2.4 (bokföringsanalogin) — annars bryts Fortnox-export och audit-trail när någon "städar" gamla fält. Värden i `metadata_snapshot` (på `work_orders` och `order_concept_objects`) använder `fieldKey` som JSON-nyckel och har ingen FK, så definitionen kan inte återskapas med samma identitet.

**How to apply:**
- DELETE när usage > 0 → 409 + payload `{ usage }`. Force kräver `?confirmUsage=N` där N **måste matcha exakt** aktuell `usage.total` (race-skydd, analogt med `?force=true` på WO freeze).
- PATCH får aldrig ändra `fieldKey` (immutable). Strukturella fält (`dataType`, `propagationType`, `applicableLevels`) blockeras med 409 så fort usage > 0 — använd `replacedByDefinitionId` vid splittring.
- Räkningen sker centralt i `storage.getMetadataDefinitionUsage(id)` så UI, DELETE-validering och eventuella scheduler-jobb använder samma definition av "i bruk". Räknar 4 källor: `object_metadata.definition_id`, aktiva `order_concepts` med matchande `cross_pollination_field`/`subscription_metadata_field`, framtida `work_orders` (`scheduled_date > NOW()`) där `metadata_snapshot ? fieldKey`, och `order_concept_objects.metadata_snapshot ? fieldKey`.
- Soft-deletade definitioner får inte PATCH:as — återställ först (sätt `deletedAt=null`).
