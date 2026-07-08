---
name: Arkiverad katalogtyp läcker på objekt-läsning
description: Objekt-metadata-läsningar måste filtrera bort arkiverade katalogtyper (mk.deleted_at IS NULL), annars blandas gamla arkiverade fält-familjer mellan områden på objektet.
---

# Arkiverad katalogtyp får aldrig rendera värden på objektet

**Regel:** Alla objekt-*värde*-läsningar som joinar `metadata_varden` → `metadata_katalog`
måste filtrera `mk.deleted_at IS NULL`. Objekt-värdevägen (`getObjectWithAllMetadata`)
var undantaget — `getAllMetadataTypes` har filtrerat arkiverade typer sedan katalog-arkivering
infördes, men objekt-värdeläsningen gjorde det inte.

**Why:** En tenant kan ha två familjer med överlappande fältnamn: en gammal ARKIVERAD
familj (t.ex. "Kontakt" under `area=grunduppgifter`) och en ny AKTIV familj (t.ex. "kontakt"
under `area=kontakt`). Objekt bär fortfarande `metadata_varden`-rader som pekar på de
arkiverade katalograderna (värdena skapades medan typen var aktiv). Utan `deleted_at`-filtret
renderas då `namn`/`e_post` under Grunduppgifter *bredvid* den aktiva familjen under
Kontaktinformation → "metadata blandas mellan metadataområden på objektet".

**How to apply:**
- Filtret hör hemma i CTE-WHERE (`metadata_with_context`) *före* `ROW_NUMBER()` så att
  nearest-first-rankingen (`rn`) räknas om utan arkiverade rader.
- `type-archive` (`metadata_katalog.deleted_at`) ≠ `value-tombstone` (`metadata_varden.raderad`).
  Blanda aldrig ihop dem: value-restore rör bara `raderad`; type-restore nollar `deleted_at`
  och gör värdena synliga igen (read-time-filter, ingen datamutation).
- Fixen tar INTE bort data — orphan-värden ligger kvar men är dolda och återställs om typen
  återställs. Ingen prod-datastädning krävs.
- Kvarvarande konsistens-gap (safe idag, callers skickar aktiva katalog-ids): batch-CTE:n
  `getObjectsMetadataValuesForCatalog` (objektlist-kolumner / koncept-matchning) saknar samma
  filter — lägg till `mk.deleted_at IS NULL` där om persistade kolumnval kan behålla id:n för
  senare arkiverade typer.
- Datan som utlöste buggen finns bara i PROD (kinab); dev är ren → fixen syns för PO först
  efter Publish.
