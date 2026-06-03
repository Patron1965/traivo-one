---
name: Metadata värde-ursprung (metod-taxonomi)
description: Vilka metod-värden räknas som automatiska/read-only på metadata_varden, och hur guards/badges ska behandla dem.
---

# Metadata värde-ursprung

`metadata_varden.metod` (varchar(50)) bär ursprunget för ett metadatavärde. Det finns INTE en enum i DB — taxonomin lever i kod (`server/metadata-queries.ts`).

- **Automatiska metod-värden** (ej manuellt satta): `system`, `tjanst`, `utforande` (legacy alias för tjänst), `import`, `berakning`, `arvd`, `auto`. Helper: `isAutomaticOrigin`.
- **Read-only-ursprung** (får ej redigeras/raderas manuellt): `system`, `tjanst`, `utforande`. Helper: `isReadonlyOrigin` / `READONLY_ORIGIN_METHODS`.
- Manuellt = `manuell` (eller tomt/okänt).

**Why:** System-genererade fält (t.ex. "Senaste arbetsorder") och tjänst-push (artikel-writeback vid utförande) ska vara spårbara och oförvanskbara. `createMetadata`/`updateMetadata` blockerar manuella writes till `isSystem`-katalogfält OCH till befintliga värden vars metod är read-only — men släpper igenom auto-origin metods (annars kan systemet inte skriva).

**How to apply:**
- Ny skrivväg som sätter metadata programmatiskt → välj rätt metod (`system`/`tjanst`/...) så den inte räknas som manuell.
- UI: `[system]`/`[tjanst]`-badges och gating av edit/delete/propagate i `ObjectMetadataPanel.tsx` styrs av `isReadonlyOrigin`. Lägg till nya read-only metods på BÅDA ställena (server-helper + frontend-helper).
- `utforande` är legacy — behandla alltid som tjänst-ursprung.

## Dubbel-koppling-varning (referens kopplad på flera ställen)
- Artiklar kopplar metadata via NAMN (text-kolumner `articles.leaveMetadataCode`/`fetchMetadataCode` = `metadata_katalog.namn`), INTE via id. Ordertyper kopplar via `order_type_metadata_links.metadataKatalogId` (id).
- `getMetadataReferenceLinkUsage(tenantId, katalogId, excludeOrderType?)` returnerar `{ field, orderTypes[], articles[] }` och slår därför upp artiklar på `field.namn`, ordertyper på id.
- Varning visas före koppling i `OrderTypeMetadataPage` (AlertDialog) och `ArticlesPage` (inline under select). Syftet är att undvika generiska fältkollisioner (t.ex. `antal` vs `antal_matavfall`).
