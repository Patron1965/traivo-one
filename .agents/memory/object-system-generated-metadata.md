---
name: Systemgenererad objekt-metadata
description: Hur objektets read-only systemgenererade metadata-vy är byggd (derive-at-read, aldrig fabricerat).
---

Objektets "systemgenererade metadata" (adress, geokodad position, inpekade orderkoncept,
kopplade uppgifter historik+kommande, bilder, felanmälningar, betyg) är **härledd vid läsning**,
inte lagrad som metadata_katalog/metadata_varden-rader.

- En enda backend-källa bygger paketet (`server/services/object-system-metadata.ts`),
  exponerad via `GET /api/objects/:id/system-generated-metadata` (tenant-ägarkontroll i routen).
- Frontend-panelen (`ObjectSystemGeneratedPanel`, prop `{ objectId }`) konsumerar endpointet och
  visas på TVÅ ställen: ObjectsPage sidopanel och ObjectDetailPage metadata-fliken. Håll prop-formen stabil.
- **Inpekade orderkoncept live-beräknas** (återanvänder delade resolvern: deriveConceptTargets +
  getObjectSubtreeIds-medlemskap + evaluateConditionsForObject) — speglar steg 4-preview/expansion.
- **"Låst" betyder bara renderad read-only**, inte en DB-lås. Geokoordinater m.m. visas skrivskyddat
  för att undvika manuell krock; ingen kolumn/lås ändras.

**Why:** Task #1085 krävde att specialflikar (Ordrar/Rating/Felanmälningar) viks in i metadata-modellen
som tydligt märkta systemfält UTAN att fabricera data eller skriva nya metadata-rader (objekt-360-principen).
**How to apply:** Lägg aldrig till ett systemfält som inte backas av en verklig kolumn/relation/live-compute;
nya fält ska in i den enda servicen så båda ytorna får dem samtidigt.
