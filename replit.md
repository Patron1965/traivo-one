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
- **Synthetic Team Resources for VRP:** For route optimization, teams are treated as single vehicles with synthetic resources, aggregating individual team member capacities and locations.

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
- **ML Duration-Prediktion (Task #421, Fas 0 aktiv, Fas 1 scaffolding):** `ml_feature_snapshots` skrivs vid VRP-jobb (fail-safe, non-blocking). `mlPredictionClient.predictDurations()` returnerar alltid `null` tills `ML_PREDICTION_ENABLED=true` + tränad modell finns. Audit via `Admin → ML datakvalitet` eller `npx tsx scripts/ml-data-quality-audit.ts`. Se `docs/ml-fas0-fas1-handover.md`.
- **Frozen WO Snapshot Idempotency:** `POST /api/work-orders/:id/freeze` is idempotent; refuses refreezing unless `?force=true` is used.
- **Price List Index Adjustment Idempotency:** `POST /api/price-lists/:id/apply-index-adjustment` is idempotent at the field level; multiple runs will overwrite `indexDate/indexPercentage` with the latest.
- **BOM Self-Referencing:** Article components (`article_components`) prevent a child article from being its own parent (`childId ≠ parentId`).
- **Portal User Scope:** An empty scope for a portal user grants full access (for backward compatibility).
- **Fortnox Export with Frozen Prices:** Fortnox export uses `frozenUnitPrice` if available on a work order; otherwise, it defaults to `line.resolvedPrice`. Existing work orders with `frozen_*=NULL` are unaffected.

## Pointers
- **Master Implementation Guide v1.0:** For overarching sprint plans and decisions.
- **ADR v2 (`adr-orderkoncept-v2.md`):** Fundamental architectural decision record for order concepts.
- **Zod Documentation:** For API schema validation understanding.
- **Drizzle ORM Documentation:** For database interaction patterns.
- **OpenAI API Documentation:** For AI integration details.
- **Geoapify Documentation:** For routing and VRP API usage.
- **Twilio API Documentation:** For SMS notification services.
- **Fortnox API Documentation:** For accounting system integration.