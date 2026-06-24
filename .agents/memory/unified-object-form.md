---
name: Enhetligt objektformulär (unified object form)
description: ObjectDetailPage är enda objektytan för create=edit=view; gamla modaler/sheet är borttagna och får inte återskapas.
---

# Enhetligt objektformulär

`client/src/pages/ObjectDetailPage.tsx` är den **kanoniska helskärmsytan** för objekt — samma surface för skapa, redigera och visa. Skapa-läget aktiveras av `isCreate = objectId === "new"` (route `/objects/:id` fångar "new"; ingen separat App.tsx-route behövs).

**Regel:** Återinför ALDRIG separata objekt-dialoger/sheets. Tidigare fanns fem ytor (create-modal, edit-modal, `ObjectDetailSheet`, full vy, `ObjectMetadataPanel`-popup). Alla utom ObjectDetailPage är borttagna. ObjectsPage navigerar nu istället:
- Skapa / tom-skapa / `?create=true` → `/objects/new`
- "Lägg till underordnat" → `/objects/new?parentId=X&parentName=enc`
- Redigera / namn-klick → `/objects/:id`
- Metadata-knapp → `/objects/:id?tab=metadata` (deep-link via `activeTab`-init från `?tab=`)

**Why:** Task #1084 — användaren ville se hela objektet (namn, multi-förälder/överordnat, släktnamn, ALL metadata) på en yta istället för utspritt i modaler.

**How to apply:**
- Create-läget POSTar `/api/objects` FÖRST, sedan loopar metadatavärden via `POST /api/metadata/` (`{objektId, metadataTypNamn, varde}`) — icke-atomiskt med avsikt: skilj "objekt kunde ej skapas" från "metadatafält misslyckades" så användaren inte skapar dubbletter. onSuccess → `navigate(/objects/:id)`.
- Alla `enabled: !!objectId`-queries i ObjectDetailPage MÅSTE gate:as med `&& !isCreate` (annars fetchar de mot id="new").
- Multi-förälder + släktnamn hanteras via `ObjectParentsPanel` (egen GitFork-trigger, okontrollerad) i sidhuvudet — inte en separat sida.
- Ärvda metadatavärden i create-läget kommer från förälderns metadata (`createInheritedSeeds` → `MetadataFieldBuilder inheritedFields`).
