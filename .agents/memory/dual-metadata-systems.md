---
name: Två parallella metadata-system
description: Traivo har två metadata-modeller (engelsk vs svensk); svenska är nu KANONISK källa för objekt-metadata, engelska är read-only audit/rollback (round-trip-drift löst).
---

# Två parallella metadata-system i Traivo

Det finns TVÅ separata dynamiska metadata-modeller som lever sida vid sida:

- **Engelsk:** `metadataDefinitions` (katalog) + `objectMetadata` (värden). Stödjer
  soft-delete (`deletedAt`), `confirmUsage`-livscykel m.m. (se metadata-definitions-lifecycle).
- **Svensk ("post-it"):** `metadataKatalog` (definition: `namn`, `beteckning`,
  `datatyp`, `allowedValues`, `allowDuplicates`, `kronologiskVisning`,
  `standardArvs`) + `metadataVarden` (typade värdekolumner) + `metadataHistorik`
  (arkiv). INGEN soft-delete — filtrera enbart på `tenantId`.

## Post-it-modellen §6.12 (svenska systemet)
- **Ersättande** (`allowDuplicates=false`): max ett lokalt värde per katalog/objekt.
  Nytt värde ersätter (UPDATE) och gammalt arkiveras i `metadataHistorik`.
- **Kompletterande** (`allowDuplicates=true`): nytt värde läggs till parallellt
  (INSERT). Identiska värden hoppas över (idempotent re-import).

## Kanonisk källa = svenska systemet (round-trip-drift LÖST)
Svenska modellen (`metadataKatalog/Varden/Historik`) är nu ENDA kanoniska källan för
objekt-metadata. ALLA läsare, skrivare OCH villkorsmotorn (orderkoncept-targeting,
portal-vy, KPI-CRUD, telink-synk, object-copy, objektmall import OCH export) går mot
svenska systemet. Engelska tabellerna (`metadataDefinitions/objectMetadata`) är denna
release READ-ONLY audit/rollback — INGA nya skrivningar (markerade `@deprecated` i
`shared/schema.ts` + `server/storage.ts`). Inga drops (expand-contract).

- `/api/metadata-definitions` (alla 6 endpoints) serveras som en COMPAT-vy över
  `metadataKatalog` via `getMetadataDefinitionsCompat`/`katalogToDefinitionCompat`
  (`id=katalog.id`, `fieldKey=deriveMetadataDotKey ?? namn`, `fieldLabel=namn`).
  Frontend (ObjectsPage, Articles*, orderkoncept-steg, MetadataDefinitionsPage,
  IndustryPackages) är oförändrad — den läser fortfarande engelska FORMEN men datan
  kommer från svenska katalogen.
- Objektmall-EXPORT round-trippar nu: läser `getMetadataDefinitionsCompat` + `metadataVarden`
  (`raderad=false`, `objektId`-nyckel via `getDisplayValue`); kolumnrubrik = `fieldKey`
  (ej `fieldLabel`) så återimport matchar `buildMetadataTypeLookup`.
- Backfill engelska→svenska: `scripts/backfill-english-metadata-to-swedish.ts` (dry-run
  default, `--confirm`; registrerad i `scripts/post-merge.sh` så prod backfillas vid merge).

**Why:** Importen skrev redan svenska (mall-semantiken `allowDuplicates`/`kronologiskVisning`
finns bara där) men resten läste engelska → en importerad fil tappade sina värden vid
export/koncept-expansion. Arkitekt-bekräftat: svenska = kanonisk.

**How to apply:** Skriv ALDRIG nytt mot `objectMetadata`/`metadataDefinitions` (insert/update).
Läs/skriv objekt-metadata via `server/metadata-queries.ts` (`createMetadata`/`updateMetadata`/
`deleteMetadata`/`writeImportedMetadataValue`/`getObjectsConditionMetadata`). Matcha katalog
på `namn` ELLER `beteckning` (case-insensitivt). Datatyp-mappning: `mapEnglishDataTypeToDatatyp`
/`mapDatatypToEnglishDataType`. Behåll computed (`arBeraknad` strippas vid läsning + blockeras
vid skrivning), kundlås och sammansatta punktnotations-fält fungerande.

## metadataKatalog-dubbletter: dedup-nyckeln måste vara enhetlig
Alla skapande-vägar för `metadataKatalog` MÅSTE deduplicera på samma nyckel — annars
uppstår flera rader med samma `namn` (visas dubbelt i importmallar/fält-väljare).
De tre vägarna: `seedDefaultMetadataTypes` (dedup på `namn`), `seedSystemMetadataLabels`
(dedup på `beteckning`) och import-auto-create (`buildMetadataTypeLookup`).

**Why:** Historiskt deduplicerade de på OLIKA nycklar → "Antal" fick 3 rader.
**How to apply:** Matcha alltid på `beteckning` ELLER `lower(namn)` innan insert; lägg
nya lookup-nycklar (namn/punktnyckel/beteckning) i `buildMetadataTypeLookup`. Engångs-
städning av befintliga dubbletter: `scripts/dedupe-metadata-katalog.ts` (per tenant,
väljer kanonisk: is_system → har beteckning → äldst, pekar om ALLA refs inkl.
`import_templates.field_ids[]` + `parent_metadata_id`, sedan delete). `concept_filters.metadata_key`
matchar på namn-sträng → kanonisk måste behålla namnet.

## Blockera nedärvning sker i svenska systemet (inte engelska breaksInheritance)
Objektformulärets metadata-datapath är det svenska systemet. "Blockera nedärvning"
(stoppa ett fält från att ärvas vidare till barn) styrs av `metadataVarden.stoppaVidareArvning`
— resolvern (`getObjectWithAllMetadata`) ackumulerar blockerade katalog-id nedför kedjan.
Engelska `objectMetadata.breaksInheritance` är en **no-op** för formulärets vy.

För ett ÄRVT fält (source='inherited', `id` = förfaderns rad — PATCH:a den ALDRIG):
materialisera en lokal kopia via `POST /api/metadata/` och sätt sedan
`PATCH /api/metadata/:id/inheritance {stoppaVidareArvning:true}`. Det finns ingen atomisk
en-endpoint-väg → klienten måste kompensera (radera den nyskapade raden om PATCH faller)
annars blir en osynlig föräldralös lokal rad kvar. Avblockera = `DELETE` den lokala raden.

**Why:** Två steg utan transaktion → partiellt fel strandar rader som varken syns som ärvda
eller blockerade. **How to apply:** Vill du ha det robust, bygg en server-side atomisk
block/unblock-endpoint; annars behåll kompenserande delete i klienten.

## Återanvändbara hjälpare (server/metadata-queries.ts)
- `coerceMetadataVardeFromRaw(katalog, raw)` → `{vardeFields, displayValue}`,
  validerar `datatyp` + `allowedValues` (kastar svenskt fel). `displayValue` =
  samma representation som `getDisplayValue` på sparad rad → preview och commit
  jämför äpplen med äpplen.
- `computeImportMetadataStatus(allowDuplicates, existingDisplayValues, newDisplayValue)`
  → ren preview-status (`create|replace|add|unchanged`).
- `writeImportedMetadataValue(exec, {...})` — tx-medveten (`MetadataExecutor` = db|tx),
  utför post-it-skrivningen atomärt i importens transaktion.

## Tredje vägen: språkmärkta visningsnamn (objects.nameTranslations)
Sedan språkmärkta namnkolumner (`namn_sv`/`namn_en`/`namn_fi`) infördes finns en TREDJE
plats där "metadata"-liknande namn kan hamna: `objects.nameTranslations` (jsonb, lang→namn).
Detta är INTE något av EAV-systemen — importen skriver det direkt på objekt-raden (merge på
update). Det påverkar ALDRIG kolumn E (`objects.name`) eller släktnamn (släktnamn byggs alltid
från internt namn). Visning sker via `display-name`-tjänstens `language`-param (fallback till
internt namn). Parsern känner igen språkkolumn via regex `^(namn|name|objektnamn)[ _-]?([a-z]{2,3})$`.

**Why:** Kravet var lokaliserade visningsnamn utan att röra det auktoritativa interna namnet
eller släktnamns-genereringen. EAV passade inte (namn är inte ett fritt metadatafält).
**How to apply:** Skriv aldrig språknamn till EAV. Läs visningsnamn via display-name-tjänsten
med `?language=`, aldrig direkt från nameTranslations i UI utan fallback.

## Område är ENDA grupperingsfältet; `kategori` är härledd legacy-spegel (svenska systemet)
`metadataKatalog` hade två konkurrerande grupperingsfält: `kategori` (gamla tekniska
värden) och `area`/Område. Område är nu det ENDA grupperingsfältet. `kategori`-kolumnen
behålls (expand-contract, ingen drop) men används aldrig för gruppering/sortering/filter
— alla läs-vägar grupperar på `area || 'annat'` (UI + `orderBy(metadataKatalog.area, …)`).

**Invariant:** `kategori = area || 'annat'` tvingas server-side på ALLA skriv-ytor —
klienten kan aldrig sätta `kategori` fritt:
- `POST/PUT /api/metadata/types` (metadata-routes): insert/`.set` skriver över `kategori`
  från effektivt område EFTER schema-parse (PUT härleder `area ?? existing.area`, självläker).
- `POST/PATCH /api/metadata-labels` (kpiRoutes): POST sätter `kategori=data.area||'annat'`;
  PATCH har tagit bort `kategori` ur updateSchema och härleder från `area` (efter system-strip).
Källa till områdesvärden/ordning/etiketter: `shared/metadata-areas.ts` (delas av alla vyer).

**Why:** Två fack för samma syfte gav dubbel logik (`område || kategori`) och drift.
**How to apply:** Lägg aldrig nya beroenden mot `kategori` och gruppera/filtrera aldrig på
den. Lägg nya områdesvärden i `shared/metadata-areas.ts`. OBS: detta gäller ENBART svenska
systemet — engelska `metadataDefinitions` har sitt eget `category`-fält, orört.

## Artikel-koppling: två katalog-nycklar i SAMMA formulär
Artikel-metadata kopplas på två sätt som råkar se identiska ut i UI:t men träffar
olika kataloger:
- **fetch/leaveMetadataCode** (`namn`): WO-writeback + concept-filters
  (`metadata-queries.ts`). "Metadata-koppling".
- **fetch/updateMetadataLabel** (`beteckning`): mobil/portal-fältvisning.
  "Etikett-koppling".

**Why:** De delar visuell sektion (slogs ihop visuellt i Task #835) men är två
distinkta katalog-nycklar. Fysisk sammanslagning kräver egen backend-migration +
paritet och är prod-riskabel.

**How to apply:** Slå ALDRIG ihop fetch/leaveMetadataCode med fetch/updateMetadataLabel
utan migration — de matchar olika katalog-kolumner och olika konsumenter.
