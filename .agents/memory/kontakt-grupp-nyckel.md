---
name: Kontaktpersoners grupp-nyckel
description: metadata_varden.grupp_nyckel binder ihop en kontakts underfält — alla kontakt-skrivvägar måste stämpla nyckeln
---

Regel: en kontaktpersons underfält (Namn/Titel/Telefon/E-post, area='kontakt', flervärdes) paras via `metadata_varden.grupp_nyckel`, INTE per index/id-ordning. Rader utan nyckel (legacy) faller tillbaka på kronologisk index-parning och listas efter de nyckel-grupperade.

**Why:** index-parning blandade ihop delvis ifyllda kontakter när ett saknat underfält kompletterades i efterhand (raden hamnade på fel person).

**How to apply:**
- Nya skrivvägar som skapar kontakt-underfält MÅSTE mynta/skicka samma nyckel för hela personen (`mintMetadataGruppNyckel`, `writeObjectKontaktPerson` gör det; `createMetadata`/`writeImportedMetadataValue` tar `gruppNyckel`; POST /api/metadata accepterar `gruppNyckel`).
- Läsvägen: `getObjectKontaktPersons` grupperar per nyckel; klientkortet kompletterar saknade underfält rad-säkert via personens `gruppNyckel`.
- Backfill (migration 0147) fryser dagens index-parning deterministiskt — kör aldrig en "smartare" ompairing i efterhand.
- Tömning av underfält vid flera kontakter är fortsatt osäker (fält-nivå-arkivering träffar hela fältet, inte en rad).
