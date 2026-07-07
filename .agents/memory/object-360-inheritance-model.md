---
name: Objektvy-360 arvsmodell
description: Låsta produktägar-beslut för objekt-360-vyns arvssemantik (redigering, snabbfälts-konfig, layout) — gäller ObjectDetailPage-ombygget.
---

# Objektvy-360 arvsmodell (låsta beslut)

Tre LÅSTA produktägar-beslut styr objekt-360-ombygget (ObjectDetailPage). De är kontrakt, inte implementationsval — avvik inte utan att om-konsultera produktägaren.

## 1. En enda scrollbar 360-vy med ankar-"snabbflikar"
Objektsidan är EN lång scrollbar vy. "Snabbflikar" är ankar-navigering (scroll-to), INTE separata route-flikar, och de GENERERAS från de faktiska metadata-områdena objektet har — inte en hårdkodad flik-lista.

## 2. Redigering av ärvt värde = redigera-VID-KÄLLAN (ingen lokal skugga)
När användaren redigerar ett värde som ärvts från en förälder finns exakt TVÅ val:
- **Redigera vid källan** → muterar förälderns värde, propagerar nedåt till alla ättlingar.
- **Ny instans på vald nivå** → skapar ett nytt eget värde på det valda objektet.

Det finns INGEN tredje "lokal skugg-override" som tyst frikopplar utan att välja nivå. Skydda mot att en write skapar en osynlig lokal kopia.
**Why:** produktägaren vill undvika tysta divergerande kopior i hierarkin; arv ska vara explicit och spårbart.

## 3. Snabbfälts-header-konfig ärvs NEDÅT via primära kedjan, åsidosättbar lägre
Vilka (upp till 3) metadatafält som visas som "snabbfält" i objekt-headern konfigureras PER OBJEKT (`object_quick_field_configs`) och ärvs nedåt genom objektets PRIMÄRA förälderkedja med **närmast-vinner**.
- En egen rad (även med alla slots null) på ett objekt är ett MEDVETET override ("visa inga snabbfält här") och stoppar arv från förälder.
- Fallback-ordning: per-objekt-kedja → `objectHeaderConfigs` per objektTYP (tenant-omfattande) → inga.
- Resolver: `resolveQuickFieldConfig(tenantId, objektId)` i `server/metadata-queries.ts` (använder `getPrimaryChainObjectIds`, self-first).
- Endpoints `GET/PUT/DELETE /api/objects/:id/quick-field-config` är MEDVETET INTE `requireAdmin` (till skillnad från tenant-vida `objectHeaderConfigs` som är admin) — motiv: "åsidosättbar på lägre nivå"; det ger ingen dataåtkomst utöver metadata användaren redan ser, kan ej korsa tenant.
**How to apply:** all snabbfälts-läsning i UI/mobil ska gå via resolvern (aldrig läsa rå objectHeaderConfigs direkt); alla katalog-id valideras server-side mot tenant + `isNull(deletedAt)`.

## 4. Snabbfälts-headerns editor har TVÅ oberoende scope
`ObjectHeaderPanel` (`HeaderQuickFieldEditor`) redigerar två ORELATERADE saker som INTE får slås ihop till en spara-knapp:
- **Snabbfält** = PER OBJEKT (`PUT/DELETE /api/objects/:id/quick-field-config`, ej admin-gate:ad). Fälten (WHICH) kommer från resolvern; VÄRDENA slås upp i objektets befintliga metadata-prop via `metadataKatalogId === katalogId`.
- **Bild & karta** = PER OBJEKTTYP (`PUT /api/object-header-config/:type`, admin). Endast synlig när objekttyp finns.
**Why:** olika arvsscope + olika behörighet; en gemensam spara skulle antingen 403:a snabbfält-sparet för icke-admin eller skriva fel scope.
**How to apply (React-gotcha):** seeda dialog-draften ENDAST på open-edge (false→true via `seededRef`), ALDRIG på varje `qfc`/config-ändring — annars klipper en spara-invalidering (som uppdaterar `qfc` medan dialogen är öppen) osparade ändringar i det ANDRA scope:t. Reseeda fält-draften separat i reset-mutationens `onSuccess` (DELETE returnerar upplöst config).
