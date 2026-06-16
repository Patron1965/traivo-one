---
name: Orderkoncept objekt/gren-inpekning
description: Steg 4 pekar in objekt/grenar (ej kluster); delad resolver-modul är enda källan så preview==execute aldrig driver isär.
---

Orderkoncept (steg 4 "Inpekning") pekar in OBJEKT/GRENAR via `order_concepts.target_object_ids` (text[], gren-ROT-id:n), INTE kluster. Upplösning sker live (expand-on-read) via `storage.getObjectSubtreeIds(tenantId, rootId)` = rekursiv CTE på primär `objects.parent_id`, tenant-scopat + `deleted_at IS NULL`. Legacy kluster-koncept faller tillbaka på `target_cluster_ids`/`target_cluster_id` (expand-contract: kluster-kolumnerna behålls).

**Enda källan till sanning:** `server/services/order-concept-targeting.ts` (`matchesFilter`, `resolveTargetObjects`, `filterObjectsByConditions`, `deriveConceptTargets`, `resolveConceptMatchingObjects`, samt single-object-vägen `evaluateConditionsForObject` + delade `buildObjectMetadataMap`/`resolveConditionValue`). ALLA vägar som räknar/härleder/testar inpekade objekt MÅSTE gå genom denna modul: condition-preview + condition-test (villkorstest mot enskilt objekt, steg 4) + execute + rerun/rullande + detect-changes + review-summary + abonnemang.

**Single-object villkorstest:** `evaluateConditionsForObject` återanvänder EXAKT samma `buildObjectMetadataMap` + `resolveConditionValue` + `matchesFilter` som bulk `filterObjectsByConditions` → enskilt-objekt-utfallet kan aldrig driva isär från preview/expansion. Lägg aldrig en separat värde-upplösning eller operator-switch i single-object-vägen. Route `POST /api/order-concepts/condition-test` måste tenant-verifiera objektet själv (`storage.getObject` är EJ tenant-scopat) och beräkna `inTargetScope` via samma `resolveTargetObjects` (null om ingen inpekning angiven).

**Why:** Det fanns tidigare 5+ kopior av operator-switchen + målupplösningen utspridda; de drev isär så att förhandsvisning visade annat än vad execute faktiskt skapade. Kluster-inpekning drog dessutom in andra kunders objekt (delade kluster = cross-customer pull-in). Gren-subträd via primär parent_id ger korrekt kund-isolering.

**How to apply:**
- Lägg ALDRIG tillbaka en inline operator-switch eller egen `getClusterObjects`-loop i en route — anropa modulen.
- `deriveConceptTargets` prioritetsordning: `targetObjectIds` → `targetClusterIds` → `targetClusterId`. Föredra alltid objectIds när satt.
- Wizardens `buildConceptPatch` (OrderConceptWizardPage) skriver ENBART `targetObjectIds`, ALDRIG `targetClusterIds`. PATCH är partiell → att utelämna kluster-fältet bevarar legacy-fallbacken. Skriv aldrig in `targetClusterIds: []` (skulle nolla fallbacken).
- Känd medveten asymmetri: ad-hoc `condition-preview` med NOLL mål returnerar tom lista, medan execute använder `fallbackAllObjects: true`. Steg 4-UI:t blockerar noll-mål så det är ofarligt i wizard-flödet; om du exponerar API:t direkt, hantera noll-mål explicit.
- Frontend-trädet (`ObjectHierarchyTree`) bygger implicit-ättling-visualen från `childrenByParent` (samma primär-parent_id som `/api/clusters/tree`), så visuellt urval matchar backend-resolvern. Backend-resolvern är dock auktoritativ.
