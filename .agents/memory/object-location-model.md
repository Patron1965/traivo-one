---
name: Objektets platsmodell (location/routability)
description: Centraliserad objekt-platslogik — platstyp, ruttbarhet, koordinat-fallback, legacy-inferens. Läs före allt arbete med objekt-geografi/ruttning.
---

# Objektets platsmodell

`server/services/object-location.ts` är den **enda** källan för objekt-platslogik
(resolveObjectLocation / objectIsRoutable / resolveEffectiveObjectLocationType).
Duplicera ALDRIG koordinat-/fallback-/ruttbarhetslogik någon annanstans — den
dependenta "Lager- & återtagslogik"-uppgiften och alla motor-/UI-callers ska
återanvända resolvern.

**Tre platstyper (`OBJECT_LOCATION_TYPES`):** pinpoint (ruttbart), area (visnings-
centroid men ALDRIG ruttbart — motorn gissar aldrig en punkt), none (ingen geografi).

**Regler som klassning och upplösning MÅSTE vara överens om:**
- Entré-koordinat räknas som "exakt punkt": den gör objektet `pinpoint` i klassningen
  OCH är en ruttbar fallback i `resolveObjectLocation` när huvudkoordinat saknas
  (huvudkoordinat föredras). Ändra aldrig den ena utan den andra — annars får du
  "pinpoint men ej ruttbar"-motsägelsen.
- `routable` är sann ENBART för pinpoint med användbar huvud- eller entré-koordinat.

**Why:** Legacy-rader har `locationType = NULL` (kolumn nullable utan default, expand-
contract). Effektiv typ härleds (användbar koord ⇒ pinpoint, polyline ⇒ area, annars
none) för att bevara EXAKT dagens ruttningsbeteende tills någon explicit sätter en typ.
En tidig version klassade entré-only som pinpoint men ruttade inte dit → UI sa "exakt
position" men motorn hoppade över objektet.

**How to apply:** Rör objekt-geografi/ruttning? Gå via resolvern. Mobil fält-korrigering
sätter `locationType='pinpoint'` + koordinater (tenant-scoped UPDATE WHERE id+tenantId,
härled tenant från tilldelad WO — `/api/mobile/*` saknar tenant-middleware). Geokodning
markerar `area` när den geokodar från stad-only och typen är osatt.

**What3words = SEKUNDÄRT platsfält, INTE i platsmodellen (Task #1110):** What3words
är användbar (icke-system) metadata i `metadata_katalog` (namn "What3words", geografi/
string, `isSystem:false`), **aldrig en hård kolumn** och påverkar **aldrig ruttbarhet**.
Det läses arvs-medvetet i `object-system-metadata.ts` (SystemPositionGroup.what3words via
`getMetadataValue`) och sätts via `POST /api/objects/:id/what3words` (upsert: säkrar
katalogposten idempotent, update/create/delete lokal `metadata_varden`-rad, tomt = rensa).
Backfill: `seed.backfillWhat3wordsField` (insert-only). UI: editerbar sektion i
`ObjectSystemGeneratedPanel` (annars read-only panel). Lägg aldrig till nya plats-
"sekundärfält" som hårda kolumner — använd katalog-metadata på samma sätt.
