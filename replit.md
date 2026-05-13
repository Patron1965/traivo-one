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
- **ML Duration-Prediktion (Task #421, Fas 0 aktiv, Fas 1 scaffolding + tillägg):** `ml_feature_snapshots` skrivs vid VRP-jobb (fail-safe, non-blocking). `mlPredictionClient.predictDurations()` returnerar alltid `null` tills `ML_PREDICTION_ENABLED=true` + tränad modell finns. Audit via `Admin → ML datakvalitet` eller `npx tsx scripts/ml-data-quality-audit.ts`. Audit returnerar `readinessLevel`: `not_ready` (<70%), `shadow_only` (70–85%), `production_eligible` (≥85%). Träningsskript `scripts/train_duration_model.py` tränar 4 kvantiler (P10/P50/P75/P90) med LightGBM. Modell-lifecycle (blue-green) via `POST /api/ml/models/:id/promote` + `/rollback` (platform-owner-only, kinab); statusövergångar `training→shadow→canary→active→deprecated`, rollback återställer `previousModelId`. Counterfactual-logging för replanning via `server/services/replanningCounterfactual.ts` → tabell `replanning_decisions` (förbereder Fas 3). Se `docs/ml-fas0-fas1-handover.md`.
- **Frozen WO Snapshot Idempotency:** `POST /api/work-orders/:id/freeze` is idempotent; refuses refreezing unless `?force=true` is used.
- **Price List Index Adjustment Idempotency:** `POST /api/price-lists/:id/apply-index-adjustment` is idempotent at the field level; multiple runs will overwrite `indexDate/indexPercentage` with the latest.
- **BOM Self-Referencing:** Article components (`article_components`) prevent a child article from being its own parent (`childId ≠ parentId`).
- **Portal User Scope:** An empty scope for a portal user grants full access (for backward compatibility).
- **Fortnox Export with Frozen Prices:** Fortnox export uses `frozenUnitPrice` if available on a work order; otherwise, it defaults to `line.resolvedPrice`. Existing work orders with `frozen_*=NULL` are unaffected.
- **Auto-tilldelning AV i produktion (säkerhet):** `resolveFallbackTenantId()` i `server/replit_integrations/auth/storage.ts` returnerar alltid `null` när `NODE_ENV=production`. Tidigare auto-tilldelades varje ny Replit-/Google-användare som loggade in via `/api/login` till tenant `kinab` — vilket innebar broken-access-control så fort `accessGranted`-checken på frontend missades eller justerades. Nu måste varje medlem bjudas in explicit via invitation-flödet (`processInvitations`). Sätt `AUTO_ASSIGN_TENANT=true` för att tillfälligt slå på auto-assign i prod (rekommenderas inte). `/api/me/tenant` returnerar `tenantId: null` för oinloggade besökare — den gamla `kinab/user`-fallbacken är borttagen. Nya Kinab-anställda läggs till genom att skapa en invitation-rad (UI: kommer; tills vidare: `INSERT INTO invitations(email,tenant_id,role,invited_by,expires_at) VALUES(...)`).
- **Demo-seed AV i produktion (Task #467):** `seedDatabase()` skippar all demo-data (`refreshDemoWorkOrderDates` + första-körnings demobootstrap) när `NODE_ENV=production` och `ENABLE_DEMO_SEED` inte är satt. `migrateDefaultTenantToKinab()` och `seedSystemMetadataLabels()` körs alltid (prod-säkra). Sätt `ENABLE_DEMO_SEED=true` för att köra demo-seed i prod (t.ex. demonstration). Reset-skriptet `scripts/kinab-reset-operational-data.ts` har en Fas H som städar bort demo-resurser (`res-tomas`, `res-anna`), demo-kluster (`cluster-telge-*` + `cluster-kommun`) och föräldralösa Fortnox-mappningar — kör `npx tsx scripts/kinab-reset-operational-data.ts --confirm RENSA-KINAB` i prod-konsolen efter publish för att få helt rent bord inför pilot.
- **Avduplicering rensningslogg (Task #448, delvis):** Klient-helpers konsoliderade — använd `formatSek(kronor)` / `formatSekFromOre(öre)` från `client/src/lib/format.ts` (öre-vs-kronor-konvention är **inte** utbytbar; DB-prisfält är öre, Fleet/Invoice-summor är kronor). Avstånd: använd `haversineDistanceKm` + `estimateTravelMinutes` från `client/src/lib/geo.ts` — lokala kopior i `RouteMap`, `weekplanner/types.ts` och `weekplanner/usePlannerData.ts` ersatta. Statusfärger: `JobDetailModal` använder nu `workOrderStatusBadge` från `lib/status-colors.ts`. Skugg-routes (`/home`, `/week-planner`, `/field`, `/simple`) är nu `wouter`-redirects till kanoniska `/`, `/planner`, `/mobile`. **Routing & kart-tiles (Task #452):** All Geoapify Routing- och Route Planner-anrop går via `server/services/routing.ts` (`fetchGeoapifyRoute`, `getRouteSummary`, `getRouteGeometry`, `callRoutePlanner`, `isGeoapifyRoutingAvailable`); ad-hoc `fetch("https://api.geoapify.com/v1/routing...")` i routes/optimizer ska ersättas av dessa helpers. Tile-URL byggs via `getMapTileConfig()` — använd den i alla `/api/system/map-config`-liknande endpoints i stället för att stränga ihop `https://maps.geoapify.com/v1/tile/...` lokalt. `route-optimizer.ts` håller fortfarande sin egen 1h LRU-cache för identiska waypoint-summeringar. **Server-utils (Task #449):** All geokodning går nu via `server/services/geocoding.ts` (re-exporterar Geoapify/Nominatim-primitiver — `geocodeAddress`, `searchDestinations`, `reverseGeocode`, `autocompleteAddress`, `lookupCityFromPostalCode`, `batchGeocode`, `isGoogleGeocodingAvailable`); `server/google-geocoding.ts` är intern implementation och ska inte importeras direkt från routes/import-flöden. Distansmatrisen är redan konsoliderad i `server/distance-matrix-service.ts`. SMS: nya kund-utskick ska gå via `server/unified-notifications.ts`; `extra-job-sms.ts` och `customer-notifications.ts` förblir separata (tekniker-resurser, `driverNotifications`-loggning, period-grindning) — se kommentar överst i respektive fil. **Återstår (separata uppföljningstasks):** IStorage-dubletter, kart-komponentbas, planner BulkScheduleDialog/AssignDialog-sammanslagning, backend WO-status-route-överlapp, SystemDashboard+TenantConfig-sammanslagning.

## Pointers
- **Master Implementation Guide v1.0:** For overarching sprint plans and decisions.
- **ADR v2 (`adr-orderkoncept-v2.md`):** Fundamental architectural decision record for order concepts.
- **Zod Documentation:** For API schema validation understanding.
- **Drizzle ORM Documentation:** For database interaction patterns.
- **OpenAI API Documentation:** For AI integration details.
- **Geoapify Documentation:** For routing and VRP API usage.
- **Twilio API Documentation:** For SMS notification services.
- **Fortnox API Documentation:** For accounting system integration.