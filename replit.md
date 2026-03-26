# Traivo - AI-Driven Field Service Planning Platform

## Overview
Traivo is an AI-driven platform optimizing field service operations for Nordic waste management companies. It aims to transform manual processes into AI-driven optimization, offering real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's vision is to become the leading commercial SaaS platform for Nordic field service with comprehensive multi-tenant capabilities.

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
The user interface includes a sticky TopNav, global search, mobile-friendly hamburger menu, Floating Action Button, QuickStats, WeekPlanner with drag-and-drop, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces feature a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, and role-based navigation filtering.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js with modular route architecture.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Full tenant isolation at database and API level with middleware and role-based access control.
- **AI Integration:** AI-first approach with OpenAI for AI Cards, AI Planning Assistant, AI Auto-Scheduling, and a Conversational AI Planner, including budget enforcement. Predictive maintenance uses AI to forecast service dates from IoT data.
- **Modus 2.0 Import System:** Step-by-step CSV data migration with validation, real-time progress, Data Health Scorecard, flexible column mapping, and detailed error reporting.
- **Geocoding:** Geoapify Geocoding API with Nominatim fallback.
- **Performance:** Database indexes, server-side pagination, optimized loading, lazy object loading, and address search/autocomplete.
- **Real-time Capabilities:** Real-time Notifications (WebSocket) and Real-time GPS Position Tracking.
- **Offline Architecture:** Complete offline-first architecture for mobile field workers using IndexedDB.
- **Automatic Anomaly Monitoring:** Background job for detecting operational anomalies and broadcasting alerts.
- **Customer Portal 2.0:** Enhanced self-service portal with token-based authentication, upcoming visits, order history, real-time chat, self-booking, and field documentation.
- **Scheduling & Reporting:** Flexible scheduling with frequency metadata, dynamic structural articles, protocol/deviation report generation, Weekly Goal Progress Bars, Geoapify Routing API distance calculations with Haversine fallback, and Auto-Fill Week functionality with Geographic Day-Clustering.
- **Distance Matrix Service:** Centralized caching for Geoapify Routing API calls with automatic Haversine fallback.
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting.
- **Environmental Statistics & Certificates:** Tracking mileage, fuel, CO2, and generation of annual environmental certificates.
- **SMS Infrastructure:** Unified multi-channel notification service supporting email and SMS.
- **Route Feedback System:** Driver daily route ratings, reason categories, free text, and reporting UI with KPI cards and charts, with an AI field assistant.
- **Planner Map:** Real-time driver/job map with real road geometry, filtering, and status updates.
- **Historical Map View:** Playback of daily GPS movement patterns per resource with timeline slider and KPI overlay.
- **Reporting & KPI Dashboard:** Enhanced `/reporting` page with tabs for overview, productivity, completion, deviations, resources, areas, and customers, featuring Recharts diagrams.
- **Work Sessions & Time Tracking (Snöret):** Complete work session management system with check-in/check-out, time entries, weekly time summaries, labor rule violation detection, and payroll CSV export.
- **Annual Planning (Årsplanering):** Annual goal tracking per customer/object with AI-driven distribution proposing optimal monthly work order distribution.
- **Equipment Sharing & Shift Collision Control:** Tracking vehicle/equipment bookings, collision detection, and availability timeline.
- **Smart AI Kontrollmallar & Field Validation:** AI-driven control templates for field workers suggesting steps based on order type and history, with mandatory field validation.
- **Invoice Preview/Generation & Fortnox Export:** Full invoicing page with preview, filtering, batch selection, Fortnox export, and export history.
- **Team Management & User Administration:** User management with admin CRUD, team system, bulk actions, and invitation system.
- **Företagsinställningar (Tenant Configuration):** Dedicated `/tenant-config` page for company setup, articles, execution codes, price lists, resources, permissions, and branded demo configuration.
- **Branded Demo Experience:** Quick branding editor in tenant settings with live preview and auto-scrape feature.
- **Fleet Management:** Comprehensive fleet management page with vehicle dashboard, maintenance planning, and fuel tracking.
- **IoT API & Automatic Order Generation:** Management of IoT devices, API keys, and signals, with auto-generation of work orders based on sensor signals.
- **Event-Driven Disruption Service:** Automated disruption detection and re-optimization suggestions for resource unavailability, emergency jobs, significant delays, and early completion. DisruptionPanel shows real-time alerts with scored suggestions and one-click application.
- **Intelligent Break Placement in VRP:** Break constraints included in Geoapify Route Planner API VRP requests, placing breaks at natural route turning points.
- **Feedback-loop — Beräknat vs Faktiskt:** Analytics comparing estimated vs actual service durations. Weekly accuracy trends, article-type deviation, per-resource accuracy, carry-over analysis, and suggested duration adjustments with planner approval. "Prediktionsnoggrannhet" tab in Reporting page with MAPE, accuracy rate, MAE KPIs.
- **Kundnotifieringar — Vi är på väg:** Automatic ETA notifications to customers when field worker marks order as "en route". Per-tenant configurable (margin, channel, trigger). LiveETAWidget in customer portal with 5-minute auto-refresh. Notification history in `eta_notifications` table. Uses existing `customerNotificationSettings` for opt-in/out. Geoapify routing for real ETA calculation.
- **SlotPreference System:** Extended object time restrictions with `preference` and `reason` fields, UI for visualization, and aggregated preferences for order placement.
- **Planned Notes (Meddelande till utförare):** Planner can write messages to field workers, displayed prominently in the SimpleFieldApp.
- **Tenant Feature Flags:** Module-based feature packaging system with 4 tiers, allowing per-tenant module enablement.
- **WeekPlanner Drag-and-Drop Improvements:** Inline conflict indicators, multi-select bulk-move, and AI "Föreslå optimal tid" per order with scoring algorithm.
- **Smart Navigation i Fältappen:** Travel distance/time display per job card, "Nästa stopp" navigation card with deep links, and 10-minute timer warning toast.
- **Smart AI Resource Allocation:** AI-förslag button in JobModal suggests top 3 best-fit resources, competency warning banner, and "Auto-fördela idag" button for unplanned orders.
- **Constraint Engine & Decision Trace:** Deterministic constraint validation layer for AI auto-schedule against hard and soft constraints, risk score calculation, and detailed `decisionTrace` logging for audit.
- **Multi-Customer Billing (Flerkund-fakturering):** Extended `objectPayers` with `isPrimary` flag and `payerLabel` field, and billing customer selection in JobModal.
- **Polyline/Polygon Support:** `polylineData` (GeoJSON) field on objects table for defining area boundaries, with PolylineEditor component, bulk find-objects-in-polygon endpoint, and inline map draw control (polygon icon button next to zoom controls in ObjectsMapTab) with toolbar, object selector, labels, and real-time drawing.
- **Map Cluster Selection Tool:** Draw polygon on objects map to spatially select objects and bulk-assign them to a new or existing cluster. Highlighted markers (amber) for selected objects, cluster creation panel with name input, and dropdown for assigning to existing clusters. Endpoint: `POST /api/objects/bulk-assign-cluster`.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Traivo optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **Mobile Field App API (Driver Core Integration):** Complete REST API for the Driver Core mobile field app. Full Traivo GO compatibility layer with dual-format support on distance API (origin/destination + fromLat/toLat), disruption triggers (orderId + workOrderId, actualElapsed + actualDuration), break config (HH:mm strings + seconds), enriched order responses (enRouteAt, customerNotified, objectAccessCode, executionStatus), and missing GO endpoints (map-config, team-invites, team-orders, customer-signoff, upload-photo, confirm-photo, auto-eta-sms, resource_profile_assignments). POST+PATCH dual-method support for work-sessions (stop/pause/resume) and notifications (read/read-all). Push token registration/removal via push_tokens table. Online/offline status tracking (isOnline, lastSeenAt on resources). Mobile disruption triggers (delay, early-completion, resource-unavailable).
- **Status Message Templates:** Configurable message templates with variable substitution for auto-responses.
- **Resource Availability Service:** Real-time resource schedule analysis computing next available time from today's work orders.
- **Portal Chat Auto-Responses:** Automatic status messages in customer portal chat when keywords like "status", "när", "ledig" are detected.
- **Mobile API Fas 2 Endpoints:** Team management (my-profiles, my-team, CRUD, invite, accept, leave), resource search, work-session entries, time-entries/summary, statistics, route/route-optimized, distance/batch distance (Geoapify with Haversine fallback), break-config, ETA notification history/config, work order carry-over, auto-ETA-SMS.

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