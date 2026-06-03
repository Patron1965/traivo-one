---
name: Metadata customer-lock (kundlås) read paths
description: Where customer-locked metadata catalog filtering must be applied so locked fields don't leak into object-facing UIs.
---

# Metadata kundlås — filtrera ALLA objekt-vända katalogläsningar

Kundlåsta metadatafält (`metadata_katalog_customers`, m2m: tom koppling = generellt
fält; annars synligt bara för kopplad kund + dess ättlingar via `parentCustomerId`)
måste filtreras på **varje objekt-vänd katalogläsning**, inte bara på admin-vyn.

**Why:** Första implementationen scopade bara `GET /api/metadata/types` (+ list/form i
MetadataSettingsPage). Objekt-pickrar ("lägg till metadata") hämtade fortfarande hela
katalogen via osc­opad `/types`, så låsta fält syntes för fel kunder — bröt acceptansen.

**How to apply:**
- Objekt-kontext ska läsa via `GET /api/metadata/objects/:objectId/available-types`
  (server härleder kundens scope från `objects.customerId` — lita ALDRIG på klient-
  skickad `customerId` för synlighet). Helper: `getAvailableMetadataTypesForObject`.
- Resolverade objekt-värden filtreras redan i `getObjectWithAllMetadata`.
- `GET /api/metadata/types` utan `?customerId` = full admin-katalog (avsiktligt).
- Import/order-flöden (`importRoutes` `getAllMetadataTypes`) honorerar ÄNNU INTE
  kundlås — avsiktligt deferred till #664 (importmallar) / #665 (order-koppling).
  När de implementeras: använd lås-medveten upplösning där kund-kontext finns.
- Scope-helpers (cykelskyddade, tenant-scoped): `getCustomerSelfAndAncestorIds`,
  `getMetadataCustomerLinks`, `isMetadataAllowedForCustomerScope` i `server/metadata-queries.ts`.
