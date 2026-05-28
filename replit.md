# Traivo - AI-Driven Field Service Planning Platform

## Run & Operate
_Populate as you build_

## Stack
**Frontend:** React, TypeScript, Vite, shadcn/ui, react-leaflet
**Backend:** Express.js, Node.js (runtime)
**Database:** PostgreSQL, Drizzle ORM
**AI/Optimization:** OpenAI, Geoapify (Routing API, VRP), OSRM, OR-Tools Optimization Service (Python FastAPI)
**Geocoding:** Geoapify, OpenStreetMap Nominatim
**Build Tool:** Vite
**Validation:** Zod (implicitly used for API schema validation)

## Where things live
- **Database Schema:** Defined implicitly via Drizzle ORM in `server/db/schema.ts` (example)
- **API Contracts:** Defined implicitly via Zod schemas and Express.js routes in `server/routes/`
  - Planner Search Filters: `server/routes/plannerRoutes.ts`
  - Article Components (BOM): `server/routes/configRoutes.ts`
  - Work Order Operations: `server/routes/workOrderRoutes.ts` (example)
  - Price List Adjustments: `server/routes/priceListRoutes.ts` (example)
  - Mobile Endpoints: `server/routes/mobile/*` (v1 oförändrad; v2: `GET /api/mobile/v2/orders/:id` exponerar frozen-snapshot, BOM-checklista, beroende-status — se `docs/traivo-go-v2-handover.md`)
- **UI Components:** `src/components/ui/` (shadcn/ui), `src/components/` for custom components
- **Shared list-state wrapper:** `client/src/components/QueryState.tsx` (Skeleton/Empty/Error)
- **Status badge tokens:** `client/src/lib/status-colors.ts` (objektstatus + work-order-status mappade till tema-tokens)
- **Theme/Styling:** Refer to Traivo Color Palette and Inter font usage for Nordic aesthetic. Använd alltid tema-tokens (`bg-destructive`, `bg-warning`, `chart-*`, `muted` osv) i nya vyer — inga `bg-red-500`/`bg-amber-*`/`text-orange-*`. Använd `warning` för varningstillstånd (tight/snart/SLA-risk/fel-räknare), `destructive` för hård-blockerande/kritiskt, och `chart-4` enbart för kategoriska neutrala saker (kärl, rast, diagramserier, navigation). Se `docs/color-harmonization-review.md`. Tabellen stöder `density="compact"` för datatäta listor.
- **Fortnox Integration:** `server/fortnox-client.ts`
- **Delivery Preferences Logic:** `storage.resolveDeliveryPreferences(objectId)`

## Architecture decisions
- **AI-First Approach:** All functionalities are designed with AI integration at their core for optimization and automation.
- **Multi-Tenant SaaS:** The platform supports multiple independent tenants with robust isolation and role-based access control.
- **Offline-First Mobile:** The mobile application is designed to function offline, syncing data when connectivity is restored to support field workers.
- **Externalized Optimization & Data Cleaning:** Complex route optimization and data validation are offloaded to dedicated external microservices to maintain core system focus and scalability.
- **Expand-Contract Strategy for DB Changes:** New database columns are introduced as nullable/default to ensure backward compatibility and avoid breaking existing integrations (e.g., Mobile, VRP, Fortnox).
- **Synthetic Team Resources for VRP:** For route optimization, teams are treated as single vehicles with synthetic resources, aggregating individual team member capacities and locations. `buildTeamVehicles()` (`server/team-vehicles.ts`) bygger fordon i prioriteringsordning: team-leader → första aktiva medlem → fallback till `team.lastPositionLat/Lng` eller `cluster.centerLatitude/Longitude` (via `team.cluster_id`). Team utan någon av dessa data hoppas över. Alla 4 callers (`server/routes/optimizationRoutes.ts` × 2, `server/optimization-job-runner.ts` × 2) skickar nu in `clusters` så fallback fungerar. Felmeddelande vid 0 ruttbara team: "Inga ruttbara team hittades. Varje aktivt team behöver minst en medlem, en team-leader, eller koppling till ett kluster med koordinater för att kunna ruttas."

## Product
- **AI-Driven Field Service Optimization:** Route planning, resource allocation, and predictive analytics for waste management.
- **Comprehensive Planning Interface:** WeekPlanner with drag-and-drop scheduling, What-If analysis, constraint overlays, and Team/Resource toggles.
- **Mobile Field App (Traivo Go):** Focus Mode, Signature Capture, Material Log, Job Protocol Generator, Day Report, Field Todo List, TimeThread Visual Timeline, QR-code reporting.
- **Customer Portal:** Self-service options including order viewing, visit confirmations, technician ratings, chat, self-bookings, issue reports, and delivery preferences, with object-scoped access.
- **Financial & Administrative Tools:** Invoice recalculation, index adjustment for price lists, Fortnox export with frozen pricing logic, team/user management, tenant configuration, fleet management.
- **Advanced Data Management:** Modus 2.0 Import System, anomaly monitoring, auto-clustering for geographical organization, delivery preference management.
- **Real-time Capabilities:** WebSocket notifications, GPS tracking, live state-sync for pop-out views.

## User preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic — Traivo Color Palette: Deep Ocean Blue (#1B4B6B), Arctic Ice (#E8F4F8), Mountain Gray (#6B7C8C), Northern Teal (#4A9B9B), Midnight Navy (#2C3E50), Aurora Green (#7DBFB0)
- **Logo:** `@assets/traivo_logo_transparent.png` (transparent bakgrund, processad från original)
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## Gotchas
Aktiva, dagliga "var-uppmärksam-på"-saker. Historiska implementations-anteckningar per task ligger i `CHANGELOG.md`.

- **Auto-tilldelning AV i prod (säkerhet):** `resolveFallbackTenantId()` returnerar alltid `null` när `NODE_ENV=production`. Nya användare måste bjudas in explicit via invitation-flödet — annars 0 access. Override med `AUTO_ASSIGN_TENANT=true` (rekommenderas inte). `/api/me/tenant` returnerar `tenantId: null` för oinloggade.
- **Demo-seed AV i prod:** `seedDatabase()` skippar demo-data när `NODE_ENV=production` och `ENABLE_DEMO_SEED` ej satt. Använd `scripts/kinab-reset-operational-data.ts --confirm RENSA-KINAB` om demo-rester ändå hamnat i prod-DB.
- **Auto-checkpoint kan committa raderingar:** Replits auto-checkpoint commit:ar disk-state utan integritetskontroll — en agent-session som råkar radera en mapp kan commit:a den som "Saved progress…" utan varning. Kör `npx tsx scripts/check-mass-deletion.ts --commits 50 --threshold 50` före varje `git push github main`. Återställning: `docs/disaster-recovery.md` §Scenario D.
- **Roll-kolumner finns på två platser:** Legacy `users.role` (global) och per-tenant `user_tenant_roles.role`. **All access-kontroll använder tenant-rollen.** Vid ändring: gå alltid via `assignUserToTenant`; `users.role` ska lämnas orörd.
- **Portal user scope:** Tom scope på `portal_users` = full access (back-compat). Sätt explicit scope för begränsning.
- **BOM self-reference:** `article_components` förbjuder `childId === parentId`.
- **Frozen prices i Fortnox-export:** Använder `frozenUnitPrice` om satt, annars `line.resolvedPrice`. WO med `frozen_*=NULL` påverkas ej.
- **Idempotenta endpoints:** `POST /api/work-orders/:id/freeze` kräver `?force=true` för omfrysning. `POST /api/price-lists/:id/apply-index-adjustment` skriver alltid över `indexDate/indexPercentage` med senaste värdet.
- **Öre vs kronor:** Använd `formatSek(kronor)` respektive `formatSekFromOre(öre)` från `client/src/lib/format.ts` — de är **inte** utbytbara. DB-prisfält är öre, Fleet/Invoice-summor är kronor.
- **Geo & routing helpers:** Avstånd via `haversineDistanceKm` / `estimateTravelMinutes` (`client/src/lib/geo.ts`). Geoapify Routing via `server/services/routing.ts`. Geokodning via `server/services/geocoding.ts`. Tile-URL via `getMapTileConfig()`. Status-badges via `client/src/lib/status-colors.ts`. Inga ad-hoc `fetch("https://api.geoapify.com/...")` i nya routes.
- **Tema-tokens i UI:** Använd `bg-destructive`, `bg-warning`, `chart-*`, `muted` osv — inga `bg-red-500`/`bg-amber-*`/`text-orange-*`. `warning` för varningstillstånd, `destructive` för kritiskt/blockerande, `chart-4` endast kategoriskt-neutralt. Se `docs/color-harmonization-review.md`.
- **Bypassad mobile-yta:** `/api/mobile/*` går utanför normal tenant-middleware. Läs aldrig `req.tenantId` där — använd `req.mobileTenantId` eller härled från autentiserad mobil-resurs.
- **Metadatadefinitioner: soft-delete + bokföringsanalogi:** `metadata_definitions` får aldrig hard-deleteas via API — `DELETE` sätter `deletedAt`. Definitioner som används (objektvärden, aktiva koncept, framtida WO med snapshot, koncept-snapshots) blockerar DELETE med 409 + strukturerad payload; force-syntax är `?confirmUsage=N` där N **måste matcha exakt** aktuell count (analogt med `?force=true` för WO freeze). PATCH blockerar strukturella fält (`dataType`, `propagationType`, `applicableLevels`) när definitionen används; `fieldKey` är alltid immutable — använd `replacedByDefinitionId` vid splittring. Historiska `metadata_snapshot`-värden förblir läsbara även efter soft-delete (Fortnox-export, audit). Centraliserad räknare: `storage.getMetadataDefinitionUsage(id)`. ADR v3 §2.4.
- **Frozen invoice recipient (3 nivåer):** `invoice_recipients` (central/area/local) hänger på kunder och ärvs uppåt via `parent_customer_id`. Resolver: `storage.resolveInvoiceRecipient(tenantId, customerId, {hintLevel, pinnedRecipientId, at})` returnerar `{recipient, sourceCustomerId, sourceLevel, conflicts, hintConflict}` — lägre kund vinner, `breaks_inheritance` kapar uppåt-arv, lika prioritet på samma nivå = konflikt som blockerar order-koncept-expansion (ERROR i `/api/order-concepts/:id/validate`). Vid `freezeWorkOrder` fryses vinnaren på WO (`frozenInvoiceRecipientId/Level/SourceCustomerId`); Fortnox-export (`exportWorkOrderToFortnox`) använder frozen-recipient om satt — annars fallback till `object_payers`/`customers.fortnoxCustomerId`. Skriv aldrig logik som expanderar koncept utan att kolla `hasConflict`.
- **Samlingsfakturor + invoice queue-state:** Varje WO har `invoiceQueueState` (NULL/`held`/`pending`/`consolidated`/`exported`). När en WO blir redo att fakturera anropas `markWorkOrderReadyForInvoice(woId, tenantId)` (`server/services/invoice-consolidation.ts`) som slår upp `resolveConsolidationPolicy` (recipient → customer → tenant-default `immediate`). `immediate` ⇒ `pending` (klar för Fortnox direkt). Annars ⇒ `held` med `invoiceHeldUntil = computePeriodEnd(now, policy)`. Hourly schemaläggare (`invoice-consolidation-scheduler`, ENV-gated `INVOICE_CONSOLIDATION_ENABLED=true` för att slå PÅ) kör `runConsolidationForTenant` per tenant, grupperar held-WOs vars `invoiceHeldUntil <= now` per recipient/customer, skapar en `customer_invoice` med `state="consolidated"` och länkar tillbaka via `workOrders.consolidationInvoiceId` + `workOrders.invoiceQueueState="consolidated"`. Manuell släpp: `POST /api/invoice-queue/release` (`requireAdmin`) skickar `force=true` och sätter `releasedBy/At/Reason` på fakturan. **Fortnox-export refuserar held WO** med svenskt felmeddelande — släpp eller vänta. **Policy ändrad mitt i period gäller från nästa period:** `invoiceHeldUntil` fryses när WO först markeras redo; senare policy-byten påverkar inte redan-held WOs i denna period — endast nya redo-markeringar. CRUD policies via `/api/invoice-consolidation-policies` (`requireAdmin` på write).
- **Objekt-kund-koppling går via order/`object_payers`:** Objekt är neutrala (ADR v3). `objects.customer_id` är under avveckling — använd `object_payers` (primary @ tidpunkt) eller `work_orders.customer_id` (beställare) för att besvara "vem hör detta objekt till". Skriv aldrig ny logik som antar att `objects.customer_id` är auktoritativ.

## Pointers
- **Master Implementation Guide v1.0:** For overarching sprint plans and decisions.
- **ADR v2 (`adr-orderkoncept-v2.md`):** Fundamental architectural decision record for order concepts.
- **ADR v3 (`docs/adr-orderkoncept-v3.md`):** Objekt-neutralitet, kund-hierarki, tre fakturanivåer, metadata-livscykel, samlingsfakturor (Session 2-principer).
- **Zod Documentation:** For API schema validation understanding.
- **Drizzle ORM Documentation:** For database interaction patterns.
- **OpenAI API Documentation:** For AI integration details.
- **Geoapify Documentation:** For routing and VRP API usage.
- **Twilio API Documentation:** For SMS notification services.
- **Fortnox API Documentation:** For accounting system integration.