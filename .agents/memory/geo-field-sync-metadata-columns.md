---
name: Geo-fält synk (metadata → objekt-kolumner)
description: Kanonisk geografimodell — metadata är källan, objekt-kolumner en enkelriktad ruttbar cache; regler, loop-säkerhet och två icke-uppenbara fällor.
---

# Kanonisk geografimodell: metadata = källa, kolumner = enkelriktad cache

De systemlåsta geo-fälten (Gatuadress/Postnummer/Postort/Koordinater = ruttbar
"standardadress"; Fördjupad position + Avdelning/Port/Våning = ALDRIG ruttbar) bor
i `metadata_varden` som **enda källan**. Objektets kolumner
(`address/postalCode/city/latitude/longitude`) är en **enkelriktad ruttbar CACHE**
som `object-location.ts` läser. Synken bor i `server/services/geo-field-sync.ts`
(`syncObjectGeoFields`, `mirrorCoordinatesToMetadata`, `backfillColumnsToMetadata`),
hookad i `runMetadataChangeJob` (cascade=true) + speglad från `geocoding.ts`.

## Hårda regler
- **PRESENT-VALUE-ONLY:** skriv en kolumn BARA när det upplösta (ärvda) metadata-
  värdet är icke-tomt OCH skiljer sig. Ett tomt/saknat metadatavärde nollar ALDRIG
  en kolumn.
  **Varför:** miljöerna är motsatta (DEV = adress i kolumner/tom metadata; PROD =
  adress i metadata/tomma kolumner). Present-only ⇒ dev no-op, prod rent additiv.
- **Fördjupad position rör ALDRIG kolumner** och är ALDRIG ruttbar.
- **Manuell vs auto koordinat:** en manuell Koordinater-rad (metod ej automatisk)
  skrivs till kolumn och geokodas ALDRIG. Auto/ingen ⇒ geokoda via befintliga
  pipelinen (`triggerGeocodeIfMissing`), som speglar tillbaka med `metod='auto'`.

## Loop-säkerhet (varför det inte snurrar)
Konvergens + in-flight-Set. `storage.updateObject` (kolumnskrivning) triggar ALDRIG
`enqueueMetadataChange` — bara `createMetadata`/`updateMetadata`/import-batch gör det.
Den enda metadata-skrivningen i cykeln är koordinat-speglingen, som no-op:ar på
likhet. Alltså: mirror → enqueue → sync andra varvet skriver inget → inget tredje varv.

## Två icke-uppenbara fällor (rättade)
- **Adress-ändring måste TVINGA om-geokodning.** `objectNeedsGeocoding` hoppar över
  objekt som redan har koordinater. Ändras en adress-strängkolumn men koordinat finns
  ⇒ punkten pekar fel tills du kallar `triggerGeocodeIfMissing(id, {force:true})`.
- **`createMetadata`s dubblett-vakt filtrerar INTE `raderad`.** En tombstonad
  Koordinater-rad ⇒ speglingen ser "ingen aktiv rad" ⇒ CREATE ⇒ dup-check kastar
  "Dubblett" vid VARJE geokodning för evigt. Kolla tombstone före CREATE; tolka den
  som "användaren tog bort koordinaten → spegla inte".

## Läs-sidan: arvs-medvetna geo-grupper (getObjectGeoFields)
`getObjectGeoFields(objektId, tenantId, preloaded?)` (metadata-queries.ts) är den
kanoniska LÄSNINGEN som objektets system-metadata (`/api/objects/:id/system-generated-metadata`) och
objekthuvud-UI:t konsumerar. Bygger TVÅ grupper (standardadress + fordjupad_position)
med per-fält KÄLLA/ARV: `source` own/inherited/missing, `fromObject`, `ownRowId`
(satt ENDAST vid own → PATCH-mål), och `katalogId` ALLTID satt (även vid missing,
via egen aktiv-katalog-SELECT) så UI kan skapa första värdet.
- **location-json-FÄLLAN:** `getMetadataValue`s datatyp-switch saknar ett `'location'`-
  fall → returnerar null för Koordinater/Fördjupad position. Läs `entry.vardeJson`
  DIREKT för location-fält (composite-json-merge gäller bara datatyp `'json'`, ej
  `'location'`, så nearest `varde_json` är rått och korrekt).
- **tombstone → missing:** en lokal `raderad=true`-rad ska ge `source:'missing'`
  (användaren tog bort värdet), inte falla tillbaka på ärvt värde.
- **Konsolidera hämtningen:** `getObjectSystemGeneratedMetadata` gör EN
  `getObjectWithAllMetadata` och matar både What3words/Fastighetsägare (via lokal
  switch-spegling av getMetadataValue) OCH `getObjectGeoFields(preloaded)` — undvik
  3 separata recursive-CTE:er för samma objekt.

## Kostnadsnoter (parkerat, ok i kinab-skala)
- Första prod-synken triggar en geokod-anrop per adress-objekt med tomma kolumner
  (fire-and-forget, ingen throttle från denna väg).
- cascade gör getObject + egen-koord-query per subträdsobjekt (N+1); överlappande
  subträd i samma debounce-batch dubbelarbetar. Revidera före stora tenants.

## Backfill
`scripts/geo-metadata-backfill.ts` — manuellt, dry-run default, `--tenant`,
`--confirm GEO-BACKFILL`. Additivt (skriver bara saknade metod='auto'-värden där
kolumn är ifylld men eget metadatavärde saknas). Kör ALDRIG vid startup.

## Import & ursprung
**Regel:** geo-värden som ska ärvas eller badge-klassas måste finnas som metadata-rader — kolumnskrivning ensam ger varken arv eller rätt ursprung. **Why:** EAV-arvet och KÄLLA-badgen läser bara metadata_varden; importflöden som bara fyller objekt-kolumner ser ut som "Systemgenererad" och ärvs aldrig. **How to apply:** varje ny skrivväg för adress/koordinater ska gå via metadata (rätt metod) och låta kolumnerna vara cache; badge-mappningen är centraliserad i shared-modulen för metadata-ursprung.
