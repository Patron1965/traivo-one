---
name: Planner-vyn saknar koncept-koppling → live-compute via objekt-metadata
description: Varför orderkoncept-authorad data (t.ex. leverans-tidsrestriktioner) måste live-beräknas per objekt på planner-JobCards istället för att joinas via work order.
---

Planner-JobCards matas av `/api/work-orders` (via `usePlannerData`), och `work_orders` har INGEN `orderConceptId`. Koncept-kopplingen finns bara på `assignments` (koncept-expansion skriver dit, se concept-expansion-target-table). Därför kan koncept-authorad data INTE visas på JobCard genom en WO→koncept-join.

**Regel:** För att visa orderkoncept-data (t.ex. `order_concepts.deliveryRestrictions`) i planeringsvyn — live-beräkna per OBJEKT: ladda alla tenantens koncept, utvärdera varje restriktions villkor mot objektets metadata (`matchesFilter` + `buildObjectMetadataMap` från order-concept-targeting), villkorslösa restriktioner gäller alla objekt. Lägg det i ett ADDITIVT endpoint + map-prop (mirror `restrictionsByObject`/`/api/time-restrictions`-mönstret), rör ALDRIG det heta `/api/work-orders`-pathet.

**Why:** Task #978 (display av leverans-tidsrestriktioner på JobCard). WO saknar konceptlänk; att lägga koncept-join i `/api/work-orders` hade både varit fel (per-objekt, ej per-WO) och belastat hot-path.

**How to apply:** Säkerhets-/DoS-krav på sådana additiva planner-endpoints: cap antal `objectIds` OCH filtrera till tenant-ägda objekt (`storage.getObjectsByIds`) FÖRE villkorslösa noter returneras — annars läcker ett godtyckligt objekt-id tillbaka tenantens restriktionstext. Endpoint bakom tenant-middleware + planner-roll.
