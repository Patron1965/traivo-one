---
name: Orderkoncept matched-count/ordervärde dedup
description: Varför matched-count och ordervärde måste härledas från en deduplicerad union i ALLA paths, aldrig summeras per gren.
---

# Orderkoncept: matched-count & ordervärde måste vara en deduplicerad union

**Regel:** Antalet matchade objekt (som driver ordervärdet i wizardens sidofält OCH i
Granska/review-summary) måste alltid härledas från en **deduplicerad union** av
matchade objekt-id:n. Summera ALDRIG matchade objekt per inpekad gren/rot.

**Why:** Objektinpekning tillåter att både en förälder och dess barn väljs explicit
(`toggleObject` lägger bara till/tar bort id; trädet hindrar bara implicit-valda
ättlingar, inte ett barn som valdes FÖRE föräldern). Sidofältet räknar via
`resolveTargetObjects({objectIds})` som dedupliceras till en union (Set/Map), medan
review-summary tidigare loopade varje rot och gjorde `totalMatchedObjects += matchedObjects.length`.
Överlappande val (barn + förfader) dubbelräknades då i Granska men inte i sidofältet
→ ordervärdet divergerade (Task #1052-buggen).

**Parity-bevis:** Unionen av per-gren-subträd == single-call-unionen (samma objekt-set).
`filterObjectsByConditions` är per-objekt-deterministisk, så ett objekt som matchar i en
gren matchar i alla grenar som innehåller det. Därför är
`new Set(allMatchedIds).size` == condition-previewns matched count.

**How to apply:** I review-summary (server/routes/orderConceptRoutes.ts) samla matchade
objekt-id:n i ett `matchedIdSet` över alla grenar/kluster och sätt
`totalMatchedObjects = matchedIdSet.size` EFTER loopen. Per-gren-nedbrytningen
(`clusterSummaries`) får visa per-gren-antal men dessa är display-only och får aldrig
summeras till värdet. Ordervärdet beräknas EN gång via delade
`computeConceptOrderValue` (`shared/order-concept-value.ts`) med `matchedCount:
totalMatchedObjects` — samma motor och samma deduplicerade antal som sidofältet.
Pengar i ÖRE; ÷100 endast vid visning.
