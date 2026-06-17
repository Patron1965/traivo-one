---
name: Delat villkorsfilter (artikel + objekt + orderkoncept)
description: Hur EN matchningsmodell driver artikellistan, objektlistan och orderkoncept-preview utan att driva isär.
---

# Delat villkorsfilter — matchesFilter som enda sanning

`shared/condition-matching.ts` (`matchesFilter`, `applyConditionFilters`,
`CONDITION_OPERATORS`, `ConditionFilter`) är ENDA källan till operator-semantik.
`server/services/order-concept-targeting.ts` re-exporterar därifrån — ändra aldrig
operator-logik på två ställen.

**Rule:** list-filtreringen är värde-upplösnings-AGNOSTISK via en `getValue(row, key)`-callback.
Varje yta resolvar sitt värde olika; matchningen är gemensam.

**Why:** Artiklar och objekt bär olika data (se `dual-metadata-systems.md`):
- **Objekt** bär metadata-VÄRDEN. `metadataKey` = `metadataDefinition.fieldKey`
  (engelska systemet). Server resolvar metadata-map först, sedan baskolumn-fallback
  (t.ex. `objectType`) via `resolveConditionValue`.
- **Artiklar** bär MATCHNINGSREGLER, inte värden. Fältalternativ = distinkta
  `associationRules`-labels (source="metadata", svensk metadataKatalog-label) +
  legacy `associationLabel`. Per-artikel-värde = regelns `value` för den label.

**How to apply:** Lägg aldrig en `objectType`-baserad filterväg i ny logik — använd
villkorsfiltret. Om en ny lista ska få samma filter: återanvänd `ConditionFilterList`
(client/.../orderkoncept/shared/ConditionFilter.tsx) + `applyConditionFilters` med en
egen `getValue` som vet hur just den radtypen lagrar sitt värde. Blanda inte ihop
artiklarnas svenska katalog-labels med objektens engelska `fieldKey`.
