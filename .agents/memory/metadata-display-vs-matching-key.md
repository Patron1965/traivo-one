---
name: Metadata fält — visningsnamn (display) vs namn (matchningsnyckel)
description: Regel för hur metadatafält-namn renderas i UI vs hur de matchas/sparas/typas; trap i formel-hints.
---

# Metadata fält: display ≠ matchningsnyckel

`metadata_katalog.namn` är den IMMUTABLA, skiftlägeskänsliga universella matchningsnyckeln
(slug, t.ex. `rullbart_karl`) som används för import-matchning, orderkoncept-targeting,
villkorsfilter, sök OCH formel-referenser. `metadata_katalog.visningsnamn` är ett fritt
redigerbart presentationsnamn (rätt versalisering + å/ä/ö, t.ex. "Rullbart kärl").

**Regel:**
- Allt som VISAS för användaren ska gå via `metadataDisplayName(k)` (`client/src/lib/metadata-display.ts`)
  → `visningsnamn?.trim() || namn.replace(/_/g," ")`. Annars ser fältnamn ut som slugs
  (gemener, inga å/ä/ö) och användaren känner inte igen sina fält ("kommer inte in i listan").
- Allt som MATCHAR/SPARAS/SLÅS UPP måste behålla `namn` (slug): `<SelectItem value={...}>`,
  sparade condition/association-nycklar, lookup, server-validering.

**Why:** En tidigare bugg visade `{namn}` (slug) i artikel-association-dropdowns → all
visningsnamn-funktion var osynlig. Fixen bytte display till `metadataDisplayName()` men
behöll value=.

**Trap (lärdes via code review):** Fält där användaren MANUELLT skriver nyckeln måste visa
slug, inte display-namn. Konkret: "Antalskälla → Formel"-hinten listar tillgängliga
`[fält]`-referenser; servern (`validateQuantityFormulaOrThrow`) validerar mot `namn`. Visa
`t.namn` där, ALDRIG `metadataDisplayName(t)` — annars skriver användaren `[Rullbart kärl]`
men giltig nyckel är `rullbart_karl` → "Okänt metadatafält".

**How to apply:** När du rör en yta som visar metadatafält-namn: byt display till
`metadataDisplayName()`, men kontrollera om värdet också *typas/sparas/matchas* — i så fall
måste den vägen fortsätta använda `namn`. Kolla även `useQuery({select})`-transformer som
kan strippa bort `visningsnamn` ur svaret.

**Backfill-begränsning:** Äldre rader med `visningsnamn=NULL` faller tillbaka till
av-understreckad slug; förlorade accenter kan ALDRIG rekonstrueras automatiskt — användaren
måste sätta `visningsnamn` manuellt (MetadataSettingsPage).
