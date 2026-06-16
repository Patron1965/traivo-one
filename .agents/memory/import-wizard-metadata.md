---
name: Import-wizard metadata write timing
description: Varför metadata i import-wizarden måste skrivas efter objekt-transaktionen, och hur header-läget avgörs i mappnings-UI:t.
---

# Import-wizard 2.0 — metadata-skrivning & header-detektion

Wizarden (`server/routes/importWizardRoutes.ts` + `client/src/components/import/ImportWizardFlow.tsx`) låter användaren mappa godtyckliga källkolumner mot systemfält, befintlig metadatatyp (svensk `metadata_katalog.namn`) eller ignorera.

## Metadata skrivs EFTER objekt-transaktionen (best-effort)
Commit-handlern samlar `{objectId, parentObjectId, metadata}`-intents under objekt-tx:n men anropar `writeObjectImportMetadataBatch` (`server/metadata-queries.ts`) FÖRST efter att tx:en committats.

**Why:** batch-helpern använder en **module-level db-anslutning** (inte tx-handle) + en **recursive CTE level-lock** som måste se de committade objekt-raderna. Körs den inuti samma tx ser CTE:n inte raderna → fel/level-lock-miss. Metadata-fel får dessutom aldrig rulla tillbaka skapade objekt.

**How to apply:** all import-/bulk-metadata via `writeObjectImportMetadataBatch` ska köras post-commit och behandlas som icke-blockerande. Validera varje nyckel mot katalogen (`getAllMetadataTypes(tenantId)` → Map) — **ingen lazy-create**; okända nycklar + helper-fel returneras som `metadataWarnings` (svenska). Ogiltiga *värden* (fel datatyp/tillåtet värde) hoppas tyst i helpern — rapporteras inte i warnings.

## Header-läge i mappnings-UI:t
`detectHeader()` (auto) gissar rubrikrad om någon cell i rad 0 matchar ett känt mål (systemfält-namn/etikett eller metadatatyp-namn/beteckning). Filer (CSV/Excel) antar alltid rubrik. Användaren kan tvinga läget via checkboxen "Första raden är rubrikrad" (`headerOverride`, null=auto).

**Why:** godtyckliga rubriker (t.ex. `INR, Butiksnamn, Gata`) matchar inga kända mål → utan override misstolkades rad 0 som data och skapade ett skräp-objekt. CSV-filer har i praktiken nästan alltid rubrik.
