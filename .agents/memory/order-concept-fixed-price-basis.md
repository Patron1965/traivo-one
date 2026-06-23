---
name: Orderkoncept fast pris-bas
description: Hur fast pris-basen (per_object/per_task/per_concept) appliceras vid expansion och i ordervärde.
---

# Fast pris-bas på orderkoncept

`order_concepts.fixed_price_basis` (default `per_object`) styr hur konceptets
`fixedPriceAmount` fördelas när konceptet expanderas till arbetsordrar.

## Modell
Expansion fördelar via en **per-WO-delare** (`computeObjectValueOre(concept, unit, qty, fixedDivisor)`),
där divisorn räknas ut av `fixedPriceWoDivisor(concept, {objectCount, occurrences})`
(`server/services/order-concept-article-hits.ts`):
- per_object → divisor = `occurrences` (beloppet per träff-objekt, fördelat över dess generationer).
- per_task → divisor = 1 (fullt belopp per genererad WO).
- per_concept → divisor = `objectCount × occurrences` (ett totalbelopp jämnt över alla WO).

Granska/sidofält använder `computeConceptOrderValue` (shared/order-concept-value.ts)
med `fixedPriceBasis`, `fixedPriceUnitCount` (= hitCount i Granska) och `taskCount`
(= hitCount × generationer).

**Why:** EN sanning för ordervärde måste gälla i sidofält, Granska och expansion,
annars divergerar visat värde mot fakturerat. Divisor-modellen håller per-WO-värdet
och totalen konsistenta oavsett bas.

## Viktig nyans
`per_object` och `per_task` ger **identiskt** per-WO-värde och total i avrop (call_off)
och förhandsvisning eftersom `occurrences = 1` där. De divergerar bara för
återkommande schema (`schedule`) där `occurrences = antal generationer`. Detta är
accepterat — basen är ändå semantiskt distinkt och syns i schema-flödet.

PATCH-route (`fortnoxRoutes.ts`) validerar `fixedPriceBasis ∈ {per_concept,per_task,per_object}`
(storage.updateOrderConcept är passthrough utan whitelist).
