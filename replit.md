# Traivo - AI-Driven Field Service Planning Platform

## Overview
Traivo is an AI-driven platform designed to optimize field service operations for Nordic waste management companies. It aims to transform manual processes into AI-driven optimization, offering real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's vision is to become the leading commercial SaaS platform for Nordic field service with comprehensive multi-tenant capabilities.

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic — Traivo Color Palette: Deep Ocean Blue (#1B4B6B), Arctic Ice (#E8F4F8), Mountain Gray (#6B7C8C), Northern Teal (#4A9B9B), Midnight Navy (#2C3E50), Aurora Green (#7DBFB0)
- **Logo:** `@assets/traivo_logo_transparent.png` (transparent bakgrund, processad från original)
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## System Architecture
The Traivo platform is a functional prototype built with a modern web stack, emphasizing a clean Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The user interface includes a sticky TopNav with smart navigation (favorites with localStorage persistence, badge counts for unassigned orders/unplanned assignments/unread messages, role-based menu filtering), global search, mobile-friendly hamburger menu, Floating Action Button, QuickStats, WeekPlanner with drag-and-drop, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces feature a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, and role-based navigation filtering.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js with modular route architecture.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Full tenant isolation at database and API level with middleware and role-based access control.
- **AI Integration:** AI-first approach with OpenAI for AI Cards, AI Planning Assistant, AI Auto-Scheduling, Conversational AI Planner, predictive maintenance, and smart AI resource allocation.
- **Modus 2.0 Import System:** Step-by-step CSV data migration with validation, real-time progress, and flexible column mapping.
- **Geocoding:** Geoapify Geocoding API with Nominatim fallback.
- **Performance:** Database indexes, server-side pagination, optimized loading, lazy object loading, and address search/autocomplete.
- **Real-time Capabilities:** Real-time Notifications (WebSocket) and Real-time GPS Position Tracking.
- **Offline Architecture:** Complete offline-first architecture for mobile field workers using IndexedDB.
- **Automatic Anomaly Monitoring:** Background job for detecting operational anomalies and broadcasting alerts.
- **Customer Portal 2.0:** Enhanced self-service portal with token-based authentication, upcoming visits, order history, real-time chat, self-booking, and field documentation.
- **Scheduling & Reporting:** Flexible scheduling, protocol/deviation report generation, Weekly Goal Progress Bars, Geoapify Routing API distance calculations with Haversine fallback, and Auto-Fill Week functionality with Geographic Day-Clustering.
- **Distance Matrix Service:** Two-level caching for Geoapify Routing API calls with automatic Haversine fallback, including precomputation and geographic pre-clustering.
- **Async Optimization Jobs:** PostgreSQL-based `optimization_jobs` for running heavy VRP optimizations asynchronously, with polling, WebSocket notifications, and automatic cleanup.
- **OR-Tools Optimization Service:** Standalone Python FastAPI microservice (`optimization-service/`) solving CVRPTW with Google OR-Tools. Includes nearest-neighbor fallback, K-Means pre-clustering for large datasets, and Docker deployment. Node.js queue adapter (`server/services/optimizationQueue.ts`) with health checking, graceful fallback to Geoapify VRP when service unavailable. Dedicated optimization routes (`server/routes/optimizationRoutes.ts`) with `buildOptimizationPayload` helper using full constraint enrichment from `vrp-constraints.ts`. Frontend solver selector (Geoapify/OR-Tools toggle) with WebSocket listener for async job completion. **Real constraint integration**: OR-Tools jobs use the same DB-driven constraints as Geoapify — time windows (object restrictions, task desired windows, slot preferences), skill matching (execution codes), vehicle capacity (tons/volume from vehicles table), and task dependencies (topological ordering).
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting.
- **Environmental Statistics & Certificates:** Tracking mileage, fuel, CO2, and generation of annual environmental certificates.
- **SMS Infrastructure:** Unified multi-channel notification service supporting email and SMS.
- **Route Feedback System:** Driver daily route ratings, reason categories, free text, and reporting UI with KPI cards and charts, with an AI field assistant.
- **Map Views:** Real-time planner map with driver/job visualization and historical map view for GPS movement playback.
- **Reporting & KPI Dashboard:** Enhanced `/reporting` page with tabs for overview, productivity, completion, deviations, resources, areas, and customers, featuring Recharts diagrams.
- **Work Sessions & Time Tracking (Snöret):** Complete work session management system with check-in/check-out, time entries, and payroll CSV export.
- **Annual Planning (Årsplanering):** Annual goal tracking per customer/object with AI-driven distribution.
- **Equipment Sharing & Shift Collision Control:** Tracking vehicle/equipment bookings, collision detection, and availability timeline.
- **Smart AI Kontrollmallar & Field Validation:** AI-driven control templates for field workers suggesting steps based on order type and history, with mandatory field validation.
- **Invoice Preview/Generation & Fortnox Export:** Full invoicing page with preview, filtering, batch selection, and Fortnox export.
- **Team Management & User Administration:** User management with admin CRUD, team system, bulk actions, and invitation system.
- **Företagsinställningar (Tenant Configuration):** Dedicated `/tenant-config` page for company setup, articles, execution codes, price lists, resources, permissions, and branded demo configuration.
- **Branded Demo Experience:** Quick branding editor in tenant settings with live preview and auto-scrape feature.
- **Fleet Management:** Comprehensive fleet management page with vehicle dashboard, maintenance planning, and fuel tracking.
- **IoT API & Automatic Order Generation:** Management of IoT devices, API keys, and signals, with auto-generation of work orders based on sensor signals.
- **Event-Driven Disruption Service:** Automated disruption detection and re-optimization suggestions for resource unavailability, emergency jobs, significant delays, and early completion.
- **Intelligent Break Placement in VRP:** Break constraints included in Geoapify Route Planner API VRP requests.
- **Feedback-loop — Beräknat vs Faktiskt:** Analytics comparing estimated vs actual service durations, with weekly accuracy trends and suggested duration adjustments.
- **Kundnotifieringar — Vi är på väg:** Automatic ETA notifications to customers when field worker marks order as "en route", with configurable settings.
- **SlotPreference System:** Extended object time restrictions with `preference` and `reason` fields and UI for visualization.
- **Planned Notes (Meddelande till utförare):** Planner can write messages to field workers, displayed prominently in the SimpleFieldApp.
- **Tenant Feature Flags:** Module-based feature packaging system with 4 tiers, allowing per-tenant module enablement.
- **WeekPlanner Drag-and-Drop Improvements:** Inline conflict indicators, multi-select bulk-move, and AI "Föreslå optimal tid" per order.
- **Smart Navigation i Fältappen:** Travel distance/time display per job card, "Nästa stopp" navigation card with deep links, and timer warning.
- **Constraint Engine & Decision Trace:** Deterministic constraint validation layer for AI auto-schedule, risk score calculation, and detailed `decisionTrace` logging.
- **Multi-Customer Billing (Flerkund-fakturering):** Extended `objectPayers` with `isPrimary` flag and `payerLabel` field, and billing customer selection in JobModal.
- **Polyline/Polygon Support:** `polylineData` (GeoJSON) field on objects table for defining area boundaries, with PolylineEditor component, bulk find-objects-in-polygon endpoint, and inline map draw control.
- **Map Cluster Selection Tool:** Draw polygon on objects map to spatially select objects and bulk-assign them to a new or existing cluster.
- **VRP Constraint Integration:** Enhanced VRP optimization with real constraint enrichment from database tables (time windows, competency, vehicle capacity, task dependencies, preferred times, resource efficiency factors).
- **VRP Route Optimization UI (Fas 4):** Enhanced `RouteOptimizationPanel.tsx` with constraint toggles, async job progress, decision trace per order, multi-day planning mode, what-if simulation, and cluster visualization.
- **Pop-out Kartövervakning:** Standalone fullscreen map monitoring window (`/monitor/popout`) with live driver positions via WebSocket, road-following route geometry, job markers, collapsible control panel with layer toggles and status filters. Launchable from both PlannerMapPage and RoutesPage.
- **Pop-out Planering:** Standalone fullscreen planner window (`/planering/popout`) with full WeekPlanner, AI panel, and job modals. Launchable from PlannerToolbar's ExternalLink button. Allows dual-screen workflow where planning runs in a separate window.
- **Akut Jobbhantering:** Urgent job assignment system with `urgent_job_assignments` table, REST API endpoints (assign, accept, decline, status update, find-nearest, reassign), WebSocket notifications to field workers, and planner UI dialog accessible from MonitorPopoutPage and PlannerMapPage. Includes nearest-technician search with distance/ETA calculation and 60-second response timeout with auto-warning.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Traivo optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **Mobile Field App API (Driver Core Integration):** Complete REST API for the Driver Core mobile field app, ensuring full Traivo GO compatibility layer with dual-format support.
- **Status Message Templates:** Configurable message templates with variable substitution for auto-responses.
- **Resource Availability Service:** Real-time resource schedule analysis computing next available time.
- **Portal Chat Auto-Responses:** Automatic status messages in customer portal chat when keywords are detected.
- **Mobile API Fas 2 Endpoints:** Team management, resource search, work-session entries, time-entries/summary, statistics, route/route-optimized, distance/batch distance, break-config, ETA notification history/config, work order carry-over, auto-ETA-SMS.
- **Mobile User Preferences API:** Server-synced user preferences (`mobileUserPreferences` table) with GET/PUT/PATCH `/api/mobile/preferences` — dark mode, font size, haptic feedback, push categories, map type, traffic overlay, break reminders, menu order, language. Auto-creates defaults on first access.
- **Mobile App Configuration API:** Server-driven app config via GET `/api/mobile/app-config` (maintenance mode, feature flags, navigation structure, tenant info) and GET `/api/mobile/version-check?version=X.Y.Z` (required/recommended update detection).
- **Mobile Statistics Summary:** Lightweight GET `/api/mobile/statistics/summary` returning today's/week's completed orders, total orders, hours worked, and work streak (consecutive weekdays with completions).

## External Dependencies
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interactions.
- **OpenAI API:** AI planning suggestions, conversational AI.
- **Geoapify:** Route calculation (Routing API) and VRP optimization (Route Planner API).
- **OpenStreetMap Nominatim:** Geocoding for Swedish addresses.
- **External Traivo Optimization Service:** Dedicated route optimization.
- **DataClean Service:** External service for data validation and geocoding.
- **Modus 2.0:** Source of CSV data for imports.
- **react-leaflet:** Interactive map visualizations.
- **shadcn/ui:** UI component library.
- **Open-Meteo API:** Provides weather forecast data.
- **Fortnox API:** Integration with the Fortnox accounting system.
- **Resend:** Email notification service.
- **Twilio API:** SMS notification service.
- **jsPDF:** PDF generation library.
- **Replit Object Storage:** Photo uploads and file storage.