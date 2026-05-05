# Traivo - AI-Driven Field Service Planning Platform

## Overview
Traivo is an AI-driven platform optimizing field service operations for Nordic waste management companies. It transforms manual processes into AI-driven solutions for route planning, resource allocation, economic control, productivity, and predictive analytics. The platform aims to be the leading commercial SaaS platform in Nordic field service with comprehensive multi-tenant capabilities, offering AI-driven optimization and real-time decision support.

## Stående bevakning: Traivo Go-integration
**Vid ALLA framtida ändringar som berör Traivo Go-integrationen ska Traivo One-agenten proaktivt föreslå åtgärd och flagga konsekvenser.** Berörningspunkter inkluderar: ändringar i `server/routes/mobile/*.ts`, `server/notifications.ts`, `shared/schema.ts` (särskilt `workOrders`, `resources`, `teams`, `workSessions`, `etaNotifications`, `customerChangeRequests`, `visitConfirmations`, `mobileUserPreferences`, `pushTokens`), auth-flöden (`isMobileAuthenticated`, mobile-token), WebSocket/realtid, ETA-notiser, sync-protokollet, eller tillägg/borttag av endpoints under `/api/mobile/*`. Kontrakt mot Go finns i `docs/api/TRAIVO_GO_INTEGRATION_REPORT_FROM_GO.md` (Go-teamets spec) och `docs/api/TRAIVO_GO_GAP_ANALYSIS_2026-04-30.md` (täckningsmatris). Kvarvarande arbete spåras i tasks #341 (kontraktsfixar), #342 (Socket.io-realtid), #343 (städa död kod).

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic — Traivo Color Palette: Deep Ocean Blue (#1B4B6B), Arctic Ice (#E8F4F8), Mountain Gray (#6B7C8C), Northern Teal (#4A9B9B), Midnight Navy (#2C3E50), Aurora Green (#7DBFB0)
- **Logo:** `@assets/traivo_logo_transparent.png` (transparent bakgrund, processad från original)
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## System Architecture
Traivo is a functional prototype built with a modern web stack, emphasizing a Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The user interface includes a sticky TopNav with smart navigation, global search, mobile-friendly hamburger menu, Floating Action Button, QuickStats, and a drag-and-drop WeekPlanner with What-If consequence analysis and a Constraint Layer overlay. The week view supports a Team/Resurs row toggle (default Team, persisted in localStorage) where teams act as primary rows; dropping a job onto a team row sets `workOrders.teamId` and clears `resourceId`, with an "Okategoriserade" group for jobs lacking a team. When a team filter is active in team mode, the planner hides the "Resurser utan team" / "Okategoriserade" rows by default but renders an amber notice banner above the team rows showing how many jobs and untied resources are hidden in the current week, plus a "Visa ändå" button that opts in to including those rows alongside the filtered teams (toggle persisted in localStorage as `showUntiedTeamRows`). When the opt-in is active, a blue banner with a "Dölj igen" button appears so the planner can return to a strict filter view. It features a RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces include a MobileFieldApp with Focus Mode for simplified order views, SignatureCapture, MaterialLog, JobProtocolGenerator, DayReport, FieldTodoList, and a TimeThread Visual Timeline. A Chain Trace Panel provides end-to-end traceability for work orders. The UI supports contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, role-based navigation filtering, and pop-out views for map monitoring and planning. The WeekPlanner supports flexible pop-outs of the calendar view OR the unscheduled-orderlager view (independently or both) via `/planering/popout?view=calendar|orderlager`, with live state-sync across windows (BroadcastChannel + localStorage fallback, 1.5s heartbeat / 4.5s timeout) and a cross-window slot picker that lets jobs in the orderlager window be assigned directly to a target slot chosen in the calendar window. A Planner Control Tower Heatmap visualizes resource occupancy and risk.

### Design System & Consistency Standards
The platform uses a consistent page header pattern (`PageHeader` component), full dark mode support, responsive tables and filters, and standardized dialog overflow handling. Color conventions are consistently applied with `dark:` variants. A reusable `EmptyState` component is used across pages. E2E tests include dark mode rendering coverage.

### Technical Implementations
The frontend uses React, TypeScript, and Vite, while the backend uses Express.js. PostgreSQL with Drizzle ORM provides data persistence, supporting tenant isolation and role-based access control. AI integration leverages OpenAI for features like AI Cards, AI Planning Assistant, AI Auto-Scheduling, and Conversational AI Planner. Geocoding uses Geoapify with Nominatim fallback. Performance is optimized through database indexing, server-side pagination, and lazy loading. Real-time capabilities include WebSocket notifications and GPS tracking with a formal WebSocket Event Catalog. An offline-first architecture is implemented for mobile field workers. The system includes an advanced Modus 2.0 Import System, anomaly monitoring, and a Customer Portal 2.0. Routing is handled by OSRM, Geoapify Routing API, and Haversine. An OR-Tools Optimization Service (Python FastAPI microservice) solves CVRPTW with complex constraints, followed by an ALNS improvement phase. Pre-clustering for large stop sets uses DBSCAN with temporal awareness. Other features include QR-code reporting, environmental statistics, SMS infrastructure, route feedback, reporting and KPI dashboards, work session and time tracking, annual planning, equipment sharing, AI control templates, invoice generation with Fortnox export, team/user management, tenant configuration, fleet management, IoT API integration, event-driven disruption service, intelligent break placement, customer ETA notifications, slot preference system, and module-based tenant feature flags.

### Fortnox Invoice History → Contract Suggestions
Users can upload a Fortnox invoice export (xlsx) under Import → Fortnox → "Fakturahistorik". The system parses invoice lines, groups them by `(customer, article)`, detects recurrence (configurable min occurrences and span), infers a billing cycle (weekly/monthly/quarterly/biannual/yearly) from the average interval, scores each pattern with a confidence based on regularity, and produces contract suggestions (`fortnox_contract_suggestions` table). Suggestions can be saved for later review and approved/rejected from the UI. Approval creates a real `customer_service_contracts` row and links the suggestion to it. Endpoints live under `/api/import/fortnox-invoices/*`.

### Team-Based Route Optimization (VRP)
Route optimization (Geoapify VRP and OR-Tools paths) treats each team as one vehicle — all members travel together in the same route. The helper `server/team-vehicles.ts` builds synthetic Resource records per active team where `id = teamId`, `name = team.name`, location/work hours come from the team leader (or first active member), and `executionCodes` is the union of all members' codes. The synthetic team-resources are passed to `optimizeRoutesVRP` (and the OR-Tools path) instead of raw resources by all entry points (`POST /api/ai/optimize-vrp`, the OR-Tools and Geoapify async jobs in `optimization-job-runner.ts`, and the synchronous fallback inside `POST /api/optimization/jobs`). The apply endpoints (`/api/ai/optimize-vrp/apply` and `/api/optimization/apply/:id`) write `workOrders.teamId` from the route's vehicle id and clear `workOrders.resourceId`. Tenants without active teams get a clear Swedish error message.

Team-level capacity/efficiency aggregation: `server/team-vehicles.ts` also exports `buildTeamMemberMap(teams, teamMembers)` which returns `Map<teamId, resourceId[]>`. This map is attached to `VRPConstraintOptions.teamMemberMap` by all four entry points. When set, `server/vrp-constraints.ts` (a) expands the resource id list before fetching `resource_articles`/`resource_vehicles` so member rows are included, (b) sums `capacityTons` + `capacityVolume` from each member's primary vehicle (deduplicating shared vehicles), and (c) computes per-job efficiency as the **mean** of each member's `baseEff * articleEff`. Backward-compatible per-resource mode kicks in automatically when no `teamMemberMap` is provided.

### Auto-Inferens av teamId från resourceId
`storage.createWorkOrder` och `storage.updateWorkOrder` sätter automatiskt `workOrders.teamId` baserat på resursens medlemskap i `team_members` när anroparen anger `resourceId` men inte `teamId`. Inferenshelpern `server/utils/teamInference.ts` har en per-tenant-cache (~30 s TTL) som invalideras när team-medlemskap eller team-data ändras (`createTeam/updateTeam/deleteTeam`, `createTeamMember/updateTeamMember/deleteTeamMember`). Inferensen följer samma cluster-prioritet som `/api/auto-plan-week/apply` (matchande cluster först, annars första teamet) och används också där via samma helper. Caller kan kringgå inferensen genom att skicka explicit `teamId` (inkl. `null`). Backfill-skript: `npx tsx scripts/backfill-work-order-team-id.ts [--tenant=<id>] [--dry-run]`.

### Auto-Cluster System
Clusters are automatically generated based on customer ownership when objects are created or imported, using the `ensureClusterForCustomer()` function. Cluster names default to customer names, and geo-center coordinates and object counts are updated post-import. In-memory deduplication prevents concurrent cluster creation. Clusters are visualized in the UI with a dedicated filter and detail pages.

### API Versioning
All REST API endpoints support versioned access via `/api/v1/` prefix. A URL-rewrite middleware strips the prefix internally. Unversioned `/api/` calls are backward compatible but receive deprecation headers and server-side logging. The frontend automatically prefixes API calls with `/api/v1/`. A version discovery endpoint `GET /api/version` is available.

### Traivo Go (Mobile App) Integration
The Traivo Go mobile app integrates with Traivo One via 94 `/api/mobile/*` endpoints (auth, orders, sync, GPS, work-sessions, AI, notifications, urgent jobs, preferences). Drivers can toggle SMS preferences from the app via `PATCH /api/mobile/me/notification-prefs` (writes `smsOnScheduleSend` / `smsOnExtraJob` directly on the resource record). Schedule publishing logs `schedule_published` / `schedule_send_failed` driver-notifications and stamps `lastSchedulePublishedAt` / `lastSchedulePeriodStart` / `lastSchedulePeriodEnd` on the resource. Subsequent assignments inside an already-published period trigger `extra_job_sms` or `cancel_job_sms` SMS + driver-notifications via Twilio. Full integration documentation lives under `docs/api/` (start with `docs/api/README.md`).

**Trade-off vid jobbskapande (Task #353):** "Skapa jobb"-modalen i Traivo One skickar inte längre `orderType`, `estimatedDuration`, `resourceId` eller `teamId`. Backend-defaults (`order_type='service'`, `estimated_duration=60`) gör att Traivo Go fortsatt får meningsfulla värden — checklista per ordertyp (`server/routes/mobile/misc.ts:310-381`, `shared.ts:263-278`) och visad estimerad tid (`shared.ts:158`, `reporting.ts:58`) fungerar oförändrat med `service`-fallback och 60 min. Den **medvetna** följden är att nya jobb visar 60 min som beräknad tid i Go tills planeraren lägger till uppgifter/artiklar i orderns detaljvy — efterföljande uppdatering kommer från planeringsflödet (annual planning, AI-planner, optimering). Följs upp separat om Go-fältet "Beräknad tid" ska beräknas från radernas `productionTime` istället.

**Glapp-analys 2026-04-30** (`docs/api/TRAIVO_GO_GAP_ANALYSIS_2026-04-30.md`): Genomgång av Go-teamets 17-sektioners integrationsrapport mot Traivo Ones aktiva mobile-routes. Huvudsak täckt, men flera verkliga glapp identifierade: **(1) Realtid blockerad** — `/ws/notifications` är raw `ws` (Go förväntar Socket.io v4 med rum `resource:X/tenant:X/team:X` + 13 namngivna events), och token-utfärdaren `POST /api/notifications/token` kräver web-session (`isAuthenticated`), vilket gör att Go inte ens kan ansluta med sin mobile-token utan en ny route. **(2) Saknad endpoint** — `GET /api/mobile/orders/:id/materials` finns inte (bara POST). **(3) Kontraktsavvikelser** — login returnerar `resourceType` som `role` istället för RBAC-roll; `/api/mobile/my-orders` har hårdkodat `customerNotified: false`; work-session-svar saknar `startedAt/totalPausedSeconds/entries`-alias; `signatureUrl` ligger på `visitConfirmations` (joinas inte i mobile-svar); `scheduledStart/End`-aliasen är inkonsekventa över endpoints; team- och resurssökning ligger på `/api/mobile/teams/*` istället för `/api/teams/*`. **(4) Städning** — `server/routes/mobileRoutes.ts` (3 440 rader) är död kod, inte registrerad någonstans, dubbletter av allt i `server/routes/mobile/*.ts`. Order-fältmappning verifierad: `enRouteAt←onWayAt`, `actualStartTime←onSiteAt`, `actualDuration`/`executionStatus`/`taskLatitude`/`impossibleReason+At+By` mappas korrekt. Spegelkopia av Go-rapporten: `docs/api/TRAIVO_GO_INTEGRATION_REPORT_FROM_GO.md`.

### System Design Choices
An AI-first approach guides all functionalities. Route optimization is offloaded to a separate Traivo optimization service, and external DataClean service handles data validation and geocoding. A complete REST API supports the Driver Core mobile field app. The system includes configurable status message templates, a resource availability service, portal chat auto-responses, and mobile API endpoints for team functions and statistics. A server-driven mobile app configuration and version check system are in place, alongside an AI Sales Intelligence Report.

## Framtida funktioner

### Klassisk CRM — medvetet utelämnat
Dagens kundregister (sidan "Kunder" på `/customers` med drill-down `/customers/:id`, samt API:et `/api/customers/*`) är **operativt orienterat**: det visar kund → objektshierarki → ordrar → karta → stats per kund och stödjer full CRUD. Det är optimerat för fältservice-arbete, inte för försäljning.

Klassiska CRM-funktioner är **medvetet utelämnade** från nuvarande scope och byggs först om kunden uttryckligen efterfrågar det:
- **Säljpipeline** (kvalificering, faser, win/loss-rate)
- **Leads och prospekt** (separat från befintliga kunder)
- **Aktivitetslogg per kund** (samtalsanteckningar, möten, e-post med tidsstämpel och ansvarig)
- **Offerter** (offert-mall, versionshantering, godkännande-flöde)
- **Deals/affärer** (värde, sannolikhet, prognoser)

Beslutet ligger fast tills kund efterfrågar utbyggnad — gör inte ad-hoc-tillägg av CRM-fält i kund- eller objektsmodellen utan att stämma av med användaren först.

## External Dependencies
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interactions.
- **OpenAI API:** AI planning, conversational AI.
- **Geoapify:** Route calculation (Routing API) and VRP optimization (Route Planner API).
- **OSRM (Open Source Routing Machine):** Real road-network distances via Table API and Route API.
- **OpenStreetMap Nominatim:** Geocoding fallback.
- **External Traivo Optimization Service:** Dedicated route optimization.
- **DataClean Service:** External service for data validation and geocoding.
- **Modus 2.0:** Source for CSV data imports.
- **react-leaflet:** Interactive map visualizations.
- **shadcn/ui:** UI component library.
- **Open-Meteo API:** Weather forecast data.
- **Fortnox API:** Accounting system integration.
- **Resend:** Email notification service.
- **Twilio API:** SMS notification service.
- **jsPDF:** PDF generation library.
- **Replit Object Storage:** Photo uploads and file storage.