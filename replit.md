# Traivo - AI-Driven Field Service Planning Platform

## Stack
**Frontend:** React, TypeScript, Vite, shadcn/ui, react-leaflet
**Backend:** Express.js, Node.js
**Database:** PostgreSQL, Drizzle ORM
**AI/Optimization:** OpenAI, Geoapify (Routing/VRP), OSRM, OR-Tools (Python FastAPI)
**Geocoding:** Geoapify, OpenStreetMap Nominatim
**Validation:** Zod

## Where things live
- **Schema:** `shared/schema.ts` (Drizzle)
- **API-routes:** `server/routes/*` — planner `plannerRoutes.ts`, BOM `configRoutes.ts`, WO `workOrderRoutes.ts`, prislista `priceListRoutes.ts`, mobil `server/routes/mobile/*` (v2 `GET /api/mobile/v2/orders/:id`, se `docs/traivo-go-v2-handover.md`)
- **UI:** `client/src/components/ui/` (shadcn), `client/src/components/` (custom); delad list-state `QueryState.tsx`
- **Theme:** Nordic-estetik, Inter-font. Använd ALLTID tema-tokens (`bg-destructive`, `bg-warning`, `chart-*`, `muted`) — aldrig `bg-red-500`/`bg-amber-*`/`text-orange-*`. `warning`=varning (tight/SLA-risk/fel), `destructive`=kritiskt/blockerande, `chart-4`=kategoriskt-neutralt. Status-badges `client/src/lib/status-colors.ts`. Se `docs/color-harmonization-review.md`. Tabell stöder `density="compact"`.
- **Fortnox:** `server/fortnox-client.ts`
- **Geo/routing/tiles:** allt via `getMapProvider()` (se Gotchas); avstånd utan API `haversineDistanceKm`/`estimateTravelMinutes` (`client/src/lib/geo.ts`)

## Architecture decisions
- **AI-First / Multi-Tenant SaaS** med tenant-isolering + rollbaserad access.
- **Offline-First Mobile** (Traivo Go), synkar vid connectivity.
- **Externaliserad optimering/data-cleaning** i separata microservices.
- **Expand-Contract för DB-ändringar:** nya kolumner nullable/default för bakåtkompatibilitet (Mobile/VRP/Fortnox).
- **Synthetic Team Resources för VRP:** team = ett fordon; `buildTeamVehicles()` (`server/team-vehicles.ts`) prioriterar team-leader → första aktiva medlem → `team.lastPositionLat/Lng`/`cluster.center*`. Alla callers skickar `clusters` för fallback; team utan koordinater hoppas över.

## Product
Route-optimering & prediktiv planering (WeekPlanner: drag-drop, What-If, constraint-overlays). Traivo Go (Focus Mode, signatur, materiallogg, dagrapport, TimeThread, QR). Kundportal (order, bekräftelser, betyg, chat, self-booking, felanmälan, leveranspref — objekt-scoped). Ekonomi (fakturaomräkning, indexjustering, Fortnox frozen-pricing, samlingsfakturor). Modus 2.0-import, anomali-övervakning, auto-clustering. Realtid (WebSocket, GPS, live state-sync).

## User preferences
- **Language:** Svenska (sv) för UI
- **Design:** Ren, professionell Nordic-estetik — Traivo-palett: Deep Ocean Blue #1B4B6B, Arctic Ice #E8F4F8, Mountain Gray #6B7C8C, Northern Teal #4A9B9B, Midnight Navy #2C3E50, Aurora Green #7DBFB0
- **Logo:** `@assets/traivo_logo_transparent.png`
- **Theme:** Dark/light mode
- **Font:** Inter
- **Development:** Alla nya funktioner ska in i frontend med navigeringslänkar — användaren vill se helheten och vad som byggs under skalet.

## Gotchas
Aktiva "var-uppmärksam-på"-regler. Djupare detalj i `.agents/memory/`, `CHANGELOG.md` och ADR-docs.

### Säkerhet / prod
- **Auto-tilldelning AV i prod:** `resolveFallbackTenantId()`=null i prod; nya användare måste bjudas in explicit (override `AUTO_ASSIGN_TENANT=true`, avrådes). `/api/me/tenant`=null för oinloggade.
- **Demo-seed AV i prod:** `seedDatabase()` skippar demo utan `ENABLE_DEMO_SEED`; rensa rester via `scripts/kinab-reset-operational-data.ts --confirm RENSA-KINAB`.
- **Auto-checkpoint kan committa raderingar:** kör `scripts/check-mass-deletion.ts --commits 50 --threshold 50` före `git push github main`. Recovery: `docs/disaster-recovery.md` §Scenario D.
- **Roll-kolumner (2 platser):** all access-kontroll använder tenant-rollen (`user_tenant_roles.role`) — ändra via `assignUserToTenant`, lämna `users.role` orörd.
- **Bypassad mobile-yta:** `/api/mobile/*` går utanför tenant-mw — använd `req.mobileTenantId` (läs aldrig `req.tenantId` där).
- **Portal user scope:** tom scope = full access (back-compat); sätt explicit scope för begränsning.

### Priser / fakturering
- **Öre vs kronor:** `formatSek(kronor)` vs `formatSekFromOre(öre)` (`client/src/lib/format.ts`) — ej utbytbara. DB-prisfält=öre, Fleet/Invoice-summor=kronor.
- **Frozen prices (Fortnox):** `frozenUnitPrice` om satt annars `line.resolvedPrice`; WO med `frozen_*=NULL` opåverkade.
- **Idempotens:** WO-freeze kräver `?force=true` för omfrysning; `apply-index-adjustment` skriver alltid över `indexDate/indexPercentage`.
- **Frozen invoice recipient (3 nivåer):** `invoice_recipients` (central/area/local) ärvs uppåt via `parent_customer_id`; `resolveInvoiceRecipient()` — lägre kund vinner, `breaks_inheritance` kapar arv, lika prioritet=konflikt som blockerar koncept-expansion. Fryses på WO vid freeze; Fortnox använder frozen annars `object_payers`/`customers.fortnoxCustomerId`. Kolla alltid `hasConflict` före expansion.
- **Samlingsfakturor:** WO har `invoiceQueueState` (NULL/held/pending/consolidated/exported). `markWorkOrderReadyForInvoice()` → policy `immediate`=pending annars held tills `invoiceHeldUntil`. Scheduler (ENV `INVOICE_CONSOLIDATION_ENABLED=true`) konsoliderar held→`customer_invoice`. Fortnox refuserar held WO. Manuell släpp: `POST /api/invoice-queue/release` (`requireAdmin`). Policy-byte gäller från nästa period. Detalj: ADR v3.
- **BOM self-reference:** `article_components` förbjuder `childId===parentId`.

### Objekt & metadata
- **Objekt är kund-neutrala (ADR v3):** `objects.customer_id` BORTTAGEN — använd `object_payers` (primär betalare) eller `work_orders.customer_id` (beställare). API `object.customerId` bevaras som payer-överlägg (läs: `primaryPayerCustomerIdSql`; skriv: `ensurePrimaryPayer`).
- **Multi-förälder & släktnamn:** objekt kan ha flera föräldrar (`object_parents`, en primär). `objects.parentId` speglar ALLTID primär — skriv aldrig ena utan andra; gå via `addObjectParentSafe`/`removeObjectParent`. Metadata-/fält-arv sker ALLTID från primär förälder; alternativa påverkar bara visningsnamn. Endpoint `GET /api/objects/:id/display-names`. Se memory `object-repoint-cycle-guard.md`.
- **Arkivering = soft-delete:** objektmall-importens `active_status` sätter `objects.deletedAt` (+`archivedBy/Reason`), ALDRIG `objects.status`. Använd `archivePreflight`/`archiveObject`/`restoreObject` (`server/services/object-archive.ts`).
- **Objektmall-import (v2, 4 nummer):** en fil → create/update/repoint per rad (interim⇒create, system/butik⇒update, ändrad förälder⇒repoint). Endast `Objektnamn`+förälder krävs; övrigt=metadata som ärvs nedåt. `[INTERIMSLISTA]`-flagga tvingar ren nyimport. Detalj: `CHANGELOG.md` #618.
- **Reversibel import (Ångra):** stämplar `import_actions` FÖRE mutationen (inkrementellt); `writeObjectImportMetadataBatch` får ALDRIG tx-wrappas. `POST /api/import/undo` (`requireAdmin`) inom 7d. Detalj: memory `import-undo-reversibility.md`.
- **Metadata: svenska = enda systemet:** `metadata_katalog`/`metadata_varden`/`metadata_historik` är enda källan; engelska (`metadata_definitions`/`object_metadata`) BORTTAGET. `/api/metadata-definitions` = compat-vy. Använd `server/metadata-queries.ts`. Detalj: memory `dual-metadata-systems.md`.
- **Metadata-katalog immutability:** `namn`+`beteckning` är universella nycklar (import-matchning, `concept_filters.metadata_key`, sök) → immutable när i bruk (409 vid rename), unika per tenant. Soft-delete (aldrig hard-delete); `?confirmUsage=N` måste matcha exakt count. Räknare: `getMetadataKatalogUsage`.

### Karta / routing
- **Provider-abstraktion (ENDA KÄLLAN):** all rutt/geokod/tile-trafik via `getMapProvider()` (`server/services/mapProvider.ts`). Impl: `routing.ts`, `geocoding.ts` (rå `geoapify-geocoding.ts` — Geoapify/Nominatim, INTE Google trots namnet `isGoogleGeocodingAvailable`). Återinför ALDRIG ad-hoc `fetch` mot `api.geoapify.com`/OSRM/`tile.googleapis.com` — lägg bakom en `MapProvider`-metod.
- **Google Maps-migration (#471):** Fas 0+1 klara, inert under default `MAP_PROVIDER=geoapify` (ingen Google-secret krävs). Cutover: `MAP_PROVIDER=google` + secrets `GOOGLE_MAPS_API_KEY`/`GOOGLE_CLOUD_PROJECT_ID` (utan nyckel → auto-fallback till Geoapify/OSM). Leaflet→Google JS SDK är separat framtida task.

## Pointers
- **ADR v3** (`docs/adr-orderkoncept-v3.md`): objekt-neutralitet, kund-hierarki, tre fakturanivåer, metadata-livscykel, samlingsfakturor. **ADR v2** (`adr-orderkoncept-v2.md`): orderkoncept-grund.
- **Uppgiftsmodell:** `docs/uppgiftsmodellen-utredning.md` + `docs/uppgiftslogik-utvecklingslogg.md` (parkerat framtida bygge, 2026-07-02). **LÅST kontrakt:** `docs/adr-uppgiftskontrakt-v1.md` + `shared/uppgift-contract.ts` (P2: gemensam uppgiftsmodell, informationspaket-fält, status som ETT fält via `deriveUppgiftStatus()`) — additivt, expand-contract; motorer/migration byggs P3+.
- **Master Implementation Guide v1.0:** övergripande sprint-planer.
- **Externa API-doc:** Zod, Drizzle ORM, OpenAI, Geoapify (routing/VRP), Twilio (SMS), Fortnox (bokföring).
