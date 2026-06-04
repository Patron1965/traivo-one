---
name: Arkiv/soft-delete-konvention
description: Regler för soft-delete (deletedAt) + arkiv/återställning som tvärsnitt över entiteter
---

# Arkiv / soft-delete-konvention

Traivo använder soft-delete (`deletedAt` + `archivedBy` + `archivedReason`, alla nullable, expand-contract) istället för hard-delete för användarvänd "radera" på: objekt, arbetsordrar, objektbilder, objektkontakter, metadatatyper (`metadataKatalog`). Undantag: `metadataDefinitions` (engelska systemet) och fält-nivå metadata-VÄRDE.

## Regler (durabla)
- **Alla arkiv-listnings- och återställnings-endpoints måste vara `requireAdmin`.** Detta gäller både den samlade `/api/archive/*`-familjen OCH de äldre objekt-specifika endpointsen (`GET /api/objects/archived`, `POST /api/objects/:id/restore`, `POST /api/work-orders/:id/restore`). 
  **Why:** Vid #716 hade objekt-/WO-arkivendpoints (från #552) ingen admin-gate medan de nya hade det — inkonsekvent och en privilege-escalation (vilken tenant-medlem som helst kunde lista/återställa arkiverade objekt). Code review (architect) flaggade detta som kritiskt.
  **How to apply:** Lägg ALDRIG till en ny arkiv-/restore-route utan `requireAdmin`. Vid ändring i `server/routes/objectLifecycleRoutes.ts` eller `server/routes/archiveRoutes.ts`: behåll admin-gaten.
- **Aktiva listningar måste filtrera `isNull(deletedAt)`** på alla läs-vägar (även inheritance-varianter), annars läcker arkiverade rader in i normala vyer.
- **Restore av metadatatyp måste blockera namn/beteckning-kollision** mot aktiv (icke-arkiverad) rad — annars bryts unikhets-invarianten (`metadata_katalog.namn`/`beteckning` är universella nycklar, se replit.md gotcha).
- **Två endpoint-familjer för objekt-arkiv:** objekt/WO-arkiv+restore bor i `objectLifecycleRoutes.ts`/`workOrderRoutes.ts` (återanvänds av ArchivePage), bild/kontakt/metadatatyp i `archiveRoutes.ts`. Sök på båda ställena vid ändring.
