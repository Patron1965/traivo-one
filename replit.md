# Traivo - AI-Driven Field Service Planning Platform

## Overview
Traivo is an AI-driven platform designed to optimize field service operations for Nordic waste management companies. It aims to transform manual processes into AI-driven solutions for route planning, resource allocation, economic control, productivity, and predictive analytics. The platform's vision is to become the leading commercial SaaS platform in Nordic field service, offering comprehensive multi-tenant capabilities, AI-driven optimization, and real-time decision support.

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic — Traivo Color Palette: Deep Ocean Blue (#1B4B6B), Arctic Ice (#E8F4F8), Mountain Gray (#6B7C8C), Northern Teal (#4A9B9B), Midnight Navy (#2C3E50), Aurora Green (#7DBFB0)
- **Logo:** `@assets/traivo_logo_transparent.png` (transparent bakgrund, processad från original)
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## System Architecture
Traivo is built as a functional prototype using a modern web stack, emphasizing a Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The platform features a sticky TopNav with smart navigation, global search, mobile-friendly hamburger menu, Floating Action Button, QuickStats, and a drag-and-drop WeekPlanner. The WeekPlanner includes What-If consequence analysis, a Constraint Layer overlay, and supports Team/Resource row toggles. It visualizes routes via a RouteMap, uses ObjectCards, and has a comprehensive Dashboard. Mobile interfaces include a MobileFieldApp with Focus Mode, SignatureCapture, MaterialLog, JobProtocolGenerator, DayReport, FieldTodoList, and a TimeThread Visual Timeline. A Chain Trace Panel provides end-to-end traceability. The UI offers contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, role-based navigation, and pop-out views for map monitoring and planning. The WeekPlanner allows flexible pop-outs of calendar or unscheduled-orderlager views with live state-sync and cross-window job assignment. A Planner Control Tower Heatmap visualizes resource occupancy and risk.

### Design System & Consistency Standards
The platform employs a consistent page header pattern, full dark mode support, responsive tables and filters, standardized dialog overflow handling, and consistent color conventions. A reusable `EmptyState` component is used across pages.

### Technical Implementations
The frontend is built with React, TypeScript, and Vite, while the backend uses Express.js. PostgreSQL with Drizzle ORM handles data persistence, supporting tenant isolation and role-based access control. AI integration utilizes OpenAI for features like AI Cards, AI Planning Assistant, AI Auto-Scheduling, and Conversational AI Planner. Geocoding uses Geoapify with Nominatim fallback. Performance is optimized through database indexing, server-side pagination, and lazy loading. Real-time capabilities include WebSocket notifications and GPS tracking. An offline-first architecture is implemented for mobile field workers. The system includes an advanced Modus 2.0 Import System, anomaly monitoring, and a Customer Portal 2.0. Routing is handled by OSRM, Geoapify Routing API, and Haversine. An OR-Tools Optimization Service (Python FastAPI microservice) solves CVRPTW with complex constraints and an ALNS improvement phase, with pre-clustering for large stop sets using DBSCAN. Other features include QR-code reporting, environmental statistics, SMS infrastructure, route feedback, reporting and KPI dashboards, work session and time tracking, annual planning, equipment sharing, AI control templates, invoice generation with Fortnox export, team/user management, tenant configuration, fleet management, IoT API integration, event-driven disruption service, intelligent break placement, customer ETA notifications, slot preference system, and module-based tenant feature flags.

### Roadmap — Sessionerna 2026-05-06 (planering, fakturering, kapacitet)
Beslut och sprint-plan från Master Implementation Guide v1.0 + planeringssession 13:51 finns i `.local/tasks/adr-orderkoncept-v3-sessioner-2026-05-06.md`. Sammanfattning:
- **F1:** additativa kolumner på `order_concepts` (`tolerance_days`, `billing_mode`, `annual_planned_value`, `season_name`), `priceLists` (`index_adjusted/date/percentage`), `articles` (`replaces_article_id`).
- **F2:** team-kapacitet (28h/12h) och vilohantering (`rest_type/rest_until/last_position_*`).
- **F3:** `planner_search_filters` (sparade sökmönster för planeraren).
- **F4:** BOM (`article_components`) + beroende-graf (`work_order_dependencies`).
- **F5:** `frozen_*` snapshot på WO + månadsfaktura med retroaktiv omräkning.
- **F6:** indexjustering + Fortnox-export mot frozen-pris.
- **F7 (frivillig):** Mobile v2 med BOM-checklista och beroende-status.
Strategi: **expand-contract** — alla nya kolumner nullable/default, befintliga 3 750 WO och Mobile/VRP/Fortnox-kontrakt orörda. ADR v2 (`adr-orderkoncept-v2.md`) står fast som grundbeslut.

### Fortnox Invoice History → Contract Suggestions
The system processes Fortnox invoice exports (xlsx) to generate contract suggestions by parsing invoice lines, grouping them by customer and article, detecting recurrence, inferring billing cycles, and scoring patterns. These suggestions can be reviewed, approved, or rejected in the UI, leading to the creation of `customer_service_contracts` records upon approval.

### Team-Based Route Optimization (VRP)
Route optimization treats each team as a single vehicle. Synthetic resource records are created for active teams, using team leader/first active member data for location/work hours and aggregating `executionCodes`. These synthetic team-resources are used in VRP optimization instead of individual resources. Applying optimized routes sets `workOrders.teamId` and clears `workOrders.resourceId`. Team-level capacity and efficiency are aggregated from individual team members.

### Auto-Inferens av teamId från resourceId
`workOrders.teamId` is automatically inferred based on a resource's team membership when `resourceId` is provided without `teamId`. This inference uses a per-tenant cache and follows cluster priority.

### Delivery Preferences (slottider per kund/objekt)
Stående leveranspreferenser lagras som JSONB på `objects.delivery_preferences` (primär) och `customers.delivery_preferences` (fallback). Schema: `weeklyWindows`, `blockedHours`, `blockedDates`, `notes`, `priority` (`preferred|strict`). `storage.resolveDeliveryPreferences(objectId)` returnerar effektiv preferens. Backend (POST/PATCH `/api/work-orders`) jämför `plannedWindowStart/End` mot effektiv preferens och cachar `outsidePreferredWindow`-flaggan på work_orders. VRP/optimering: `strict` => snäva `time_windows` + +20 priority bonus, `preferred` => +10 prioritet (mjuk). UI: editor på objekt-/kund-detaljsidor (tab "Leveranspreferenser"), gul badge "Utanför slottid" på `JobCard`. Mobile (Traivo Go) får `deliveryPreferenceNotes` och `outsidePreferredWindow` per order. Kundportal har `GET/PUT /api/portal/delivery-preferences`.

### Portal-användare med per-objekt-scope
Kundportalen stödjer flera portal-användare per kund med valfri begränsning till specifika objekt. Schema: `portal_users` (tenant+customer+email unik) och `portal_user_object_scopes`. Vid magic-link-login `upsertar` `verifyMagicLink` en portal-user och kopplar `customer_portal_sessions.portal_user_id`. `requirePortalAuth` resolverar `scopedObjectIds` (rekursiv CTE inkl. descendants) och alla portal-endpoints (`orders`, `objects`, `clusters`, `visit-protocols`, `completed-jobs`, `visit-confirmations`, `technician-ratings`, `work-order-chat`, `self-bookings`, `booking-requests`, `issue-reports`, `delivery-preferences`, `field/*`, `qr-lookup`) filtrerar på objektsId. **Tomt scope = full access (bakåtkompat).** Admin-UI: tab "Portal-användare" på kunddetaljsidan; portalanvändaren ser en gul scope-badge i headern. Endpoints: `GET/POST /api/customers/:id/portal-users`, `PUT /api/portal-users/:id/scope`, `DELETE /api/portal-users/:id` (alla `requireAdmin`).

### Auto-Cluster System
Clusters are automatically generated based on customer ownership during object creation or import. Cluster names default to customer names, and geo-center coordinates and object counts are updated post-import. Clusters are visualized in the UI with dedicated filters and detail pages.

### API Versioning
All REST API endpoints support versioned access via `/api/v1/` prefix. A URL-rewrite middleware handles the prefix internally. Unversioned calls are backward compatible but receive deprecation headers. The frontend automatically prefixes API calls.

### Traivo Go (Mobile App) Integration
The Traivo Go mobile app integrates with Traivo One through numerous `/api/mobile/*` endpoints, covering authentication, orders, sync, GPS, work-sessions, AI, notifications, urgent jobs, and user preferences. Drivers can manage SMS preferences from the app. Schedule publishing triggers notifications and updates resource records. Subsequent assignments within a published period activate extra job or cancellation SMS and driver notifications via Twilio.

### System Design Choices
An AI-first approach guides all functionalities. Route optimization is offloaded to a separate Traivo optimization service, and an external DataClean service handles data validation and geocoding. A complete REST API supports the Driver Core mobile field app. The system includes configurable status message templates, a resource availability service, portal chat auto-responses, and mobile API endpoints for team functions and statistics. A server-driven mobile app configuration and version check system are in place, alongside an AI Sales Intelligence Report. Classic CRM functionalities are intentionally excluded from the current scope.

## External Dependencies
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interactions.
- **OpenAI API:** AI planning, conversational AI.
- **Geoapify:** Route calculation (Routing API) and VRP optimization (Route Planner API).
- **OSRM (Open Source Routing Machine):** Real road-network distances.
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