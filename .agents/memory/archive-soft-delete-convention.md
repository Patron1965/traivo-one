---
name: Arkiv/soft-delete-konvention
description: Regler för soft-delete (deletedAt) + arkiv/återställning som tvärsnitt över entiteter
---

# Arkiv / soft-delete-konvention

Traivo använder soft-delete (`deletedAt` + `archivedBy` + `archivedReason`, alla nullable, expand-contract) istället för hard-delete för användarvänd "radera" på: objekt, arbetsordrar, objektbilder, objektkontakter, metadatatyper (`metadataKatalog`). Undantag: `metadataDefinitions` (engelska systemet) och fält-nivå metadata-VÄRDE.

## Regler (durabla)
- **Alla arkiv-listnings- och återställnings-endpoints måste vara `requireAdmin`.** Detta gäller både den samlade `/api/archive/*`-familjen OCH de äldre objekt-specifika endpointsen (`GET /api/objects/archived`, `POST /api/objects/:id/restore`, `POST /api/work-orders/:id/restore`). 
  **Why:** De äldre objekt-/WO-arkivendpointsen saknade en gång admin-gate medan de nyare hade det — inkonsekvent och en privilege-escalation (vilken tenant-medlem som helst kunde lista/återställa arkiverade objekt). Code review flaggade detta som kritiskt.
  **How to apply:** Lägg ALDRIG till en ny arkiv-/restore-route utan `requireAdmin`. Vid ändring i `server/routes/objectLifecycleRoutes.ts` eller `server/routes/archiveRoutes.ts`: behåll admin-gaten.
- **Aktiva listningar måste filtrera `isNull(deletedAt)`** på alla läs-vägar (även inheritance-varianter), annars läcker arkiverade rader in i normala vyer.
- **Räkne-/blockerings-guards över soft-deletebara rader måste filtrera `isNull(deletedAt)`.** Annars blockerar redan-arkiverade barn för evigt en åtgärd på föräldern.
  **Why:** ett metadata-gruppfält ("Kontakt"/"Adress", familj-förälder via `parentMetadataId`) gick inte att arkivera fast användaren arkiverat ALLA underfält — `countMetadataChildren` (+ två parallella barn-räkningar i `kpiRoutes.ts`) räknade soft-deletade barn. Soft-deletade barn behåller sin `parentMetadataId`.
  **How to apply:** varje COUNT/EXISTS som styr om en förälder får arkiveras/raderas/ändras måste exkludera `deletedAt IS NOT NULL`. Sök ALLA call-sites — samma invariant fanns på 3 ställen (1 i `metadata-routes.ts`, 2 i `kpiRoutes.ts`).
- **Restore av metadatatyp måste blockera namn/beteckning-kollision** mot aktiv (icke-arkiverad) rad — annars bryts unikhets-invarianten (`metadata_katalog.namn`/`beteckning` är universella nycklar, se replit.md gotcha).
- **Två endpoint-familjer för objekt-arkiv:** objekt/WO-arkiv+restore bor i `objectLifecycleRoutes.ts`/`workOrderRoutes.ts` (återanvänds av ArchivePage), bild/kontakt/metadatatyp i `archiveRoutes.ts`. Sök på båda ställena vid ändring.
