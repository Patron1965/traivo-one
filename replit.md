# Plannix - AI-Driven Field Service Planning Platform

## Overview
Plannix is an AI-driven platform optimizing field service operations for Nordic waste management companies. It transforms manual processes into AI-driven solutions for route planning, resource allocation, economic control, productivity, and predictive analytics. The platform aims to be the leading commercial SaaS platform in Nordic field service with comprehensive multi-tenant capabilities, offering AI-driven optimization and real-time decision support.

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic — Plannix Color Palette: Deep Ocean Blue (#1B4B6B), Arctic Ice (#E8F4F8), Mountain Gray (#6B7C8C), Northern Teal (#4A9B9B), Midnight Navy (#2C3E50), Aurora Green (#7DBFB0)
- **Logo:** `@assets/traivo_logo_transparent.png` (transparent bakgrund, processad från original)
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## System Architecture
Plannix is a functional prototype built with a modern web stack, emphasizing a Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The user interface includes a sticky TopNav with smart navigation, global search, mobile-friendly hamburger menu, Floating Action Button, QuickStats, and a drag-and-drop WeekPlanner with What-If consequence analysis and a Constraint Layer overlay. The week view supports a Team/Resurs row toggle (default Team, persisted in localStorage) where teams act as primary rows; dropping a job onto a team row sets `workOrders.teamId` and clears `resourceId`, with an "Okategoriserade" group for jobs lacking a team. It features a RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces include a MobileFieldApp with Focus Mode for simplified order views, SignatureCapture, MaterialLog, JobProtocolGenerator, DayReport, FieldTodoList, and a TimeThread Visual Timeline. A Chain Trace Panel provides end-to-end traceability for work orders. The UI supports contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, role-based navigation filtering, and pop-out views for map monitoring and planning. A Planner Control Tower Heatmap visualizes resource occupancy and risk.

### Design System & Consistency Standards
The platform uses a consistent page header pattern (`PageHeader` component), full dark mode support, responsive tables and filters, and standardized dialog overflow handling. Color conventions are consistently applied with `dark:` variants. A reusable `EmptyState` component is used across pages. E2E tests include dark mode rendering coverage.

### Technical Implementations
The frontend uses React, TypeScript, and Vite, while the backend uses Express.js. PostgreSQL with Drizzle ORM provides data persistence, supporting tenant isolation and role-based access control. AI integration leverages OpenAI for features like AI Cards, AI Planning Assistant, AI Auto-Scheduling, and Conversational AI Planner. Geocoding uses Geoapify with Nominatim fallback. Performance is optimized through database indexing, server-side pagination, and lazy loading. Real-time capabilities include WebSocket notifications and GPS tracking with a formal WebSocket Event Catalog. An offline-first architecture is implemented for mobile field workers. The system includes an advanced Modus 2.0 Import System, anomaly monitoring, and a Customer Portal 2.0. Routing is handled by OSRM, Geoapify Routing API, and Haversine. An OR-Tools Optimization Service (Python FastAPI microservice) solves CVRPTW with complex constraints, followed by an ALNS improvement phase. Pre-clustering for large stop sets uses DBSCAN with temporal awareness. Other features include QR-code reporting, environmental statistics, SMS infrastructure, route feedback, reporting and KPI dashboards, work session and time tracking, annual planning, equipment sharing, AI control templates, invoice generation with Fortnox export, team/user management, tenant configuration, fleet management, IoT API integration, event-driven disruption service, intelligent break placement, customer ETA notifications, slot preference system, and module-based tenant feature flags.

### Fortnox Invoice History → Contract Suggestions
Users can upload a Fortnox invoice export (xlsx) under Import → Fortnox → "Fakturahistorik". The system parses invoice lines, groups them by `(customer, article)`, detects recurrence (configurable min occurrences and span), infers a billing cycle (weekly/monthly/quarterly/biannual/yearly) from the average interval, scores each pattern with a confidence based on regularity, and produces contract suggestions (`fortnox_contract_suggestions` table). Suggestions can be saved for later review and approved/rejected from the UI. Approval creates a real `customer_service_contracts` row and links the suggestion to it. Endpoints live under `/api/import/fortnox-invoices/*`.

### Auto-Cluster System
Clusters are automatically generated based on customer ownership when objects are created or imported, using the `ensureClusterForCustomer()` function. Cluster names default to customer names, and geo-center coordinates and object counts are updated post-import. In-memory deduplication prevents concurrent cluster creation. Clusters are visualized in the UI with a dedicated filter and detail pages.

### API Versioning
All REST API endpoints support versioned access via `/api/v1/` prefix. A URL-rewrite middleware strips the prefix internally. Unversioned `/api/` calls are backward compatible but receive deprecation headers and server-side logging. The frontend automatically prefixes API calls with `/api/v1/`. A version discovery endpoint `GET /api/version` is available.

### Traivo Go (Mobile App) Integration
The Traivo Go mobile app integrates with Traivo One via 94 `/api/mobile/*` endpoints (auth, orders, sync, GPS, work-sessions, AI, notifications, urgent jobs, preferences). Drivers can toggle SMS preferences from the app via `PATCH /api/mobile/me/notification-prefs` (writes `smsOnScheduleSend` / `smsOnExtraJob` directly on the resource record). Schedule publishing logs `schedule_published` / `schedule_send_failed` driver-notifications and stamps `lastSchedulePublishedAt` / `lastSchedulePeriodStart` / `lastSchedulePeriodEnd` on the resource. Subsequent assignments inside an already-published period trigger `extra_job_sms` or `cancel_job_sms` SMS + driver-notifications via Twilio. Full integration documentation lives under `docs/api/` (start with `docs/api/README.md`).

### System Design Choices
An AI-first approach guides all functionalities. Route optimization is offloaded to a separate Plannix optimization service, and external DataClean service handles data validation and geocoding. A complete REST API supports the Driver Core mobile field app. The system includes configurable status message templates, a resource availability service, portal chat auto-responses, and mobile API endpoints for team functions and statistics. A server-driven mobile app configuration and version check system are in place, alongside an AI Sales Intelligence Report.

## External Dependencies
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interactions.
- **OpenAI API:** AI planning, conversational AI.
- **Geoapify:** Route calculation (Routing API) and VRP optimization (Route Planner API).
- **OSRM (Open Source Routing Machine):** Real road-network distances via Table API and Route API.
- **OpenStreetMap Nominatim:** Geocoding fallback.
- **External Plannix Optimization Service:** Dedicated route optimization.
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