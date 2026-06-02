---
name: Två parallella metadata-system
description: Traivo har två icke-synkade metadata-modeller (engelsk vs svensk); import skriver den ena, export läser den andra → round-trip-drift.
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

## Round-trip-drift (VIKTIGT)
Objektmall-**importen skriver det svenska systemet** (`metadataKatalog/Varden/Historik`),
men objekt-**exporten läser fortfarande det engelska** (`metadataDefinitions/objectMetadata`).
En importerad fil som exporteras igen får alltså INTE tillbaka sina metadata-värden.

**Why:** Importen valdes mot svenska systemet eftersom mall-kolumnernas semantik
(`allowDuplicates`, `kronologiskVisning`) bara finns där. Export migrerades aldrig.

**How to apply:** Innan du rör import/export av metadata — kolla vilket system koden
faktiskt träffar. Matcha katalog-kolumner mot `metadataKatalog` på `namn` ELLER
`beteckning` (case-insensitivt). Skriv aldrig logik som antar att de två systemen är
synkade. En framtida task bör ena dem (eller spegla export mot svenska systemet).

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
