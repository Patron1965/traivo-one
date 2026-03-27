# Traivo - AI-Driven Field Service Planning Platform

## Overview
Traivo is an AI-driven platform designed to optimize field service operations for Nordic waste management companies. Its core purpose is to transform manual processes into efficient, AI-driven solutions, offering real-time decision support for route planning, resource allocation, economic control, productivity analysis, and predictive analytics. The project's overarching vision is to establish itself as the leading commercial SaaS platform for Nordic field service, providing comprehensive multi-tenant capabilities.

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic — Traivo Color Palette: Deep Ocean Blue (#1B4B6B), Arctic Ice (#E8F4F8), Mountain Gray (#6B7C8C), Northern Teal (#4A9B9B), Midnight Navy (#2C3E50), Aurora Green (#7DBFB0)
- **Logo:** `@assets/traivo_logo_transparent.png` (transparent bakgrund, processad från original)
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## System Architecture
The Traivo platform is a functional prototype built with a modern web stack, characterized by a clean Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The user interface includes a sticky TopNav, global search, mobile-friendly hamburger menu, Floating Action Button, QuickStats, WeekPlanner with drag-and-drop, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces feature a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, and role-based navigation filtering.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js with modular route architecture.
- **Database:** PostgreSQL with Drizzle ORM, supporting full tenant isolation and role-based access control.
- **AI Integration:** AI-first approach with OpenAI for AI Cards, Planning Assistant, Auto-Scheduling, and a Conversational AI Planner, including budget enforcement and predictive maintenance from IoT data.
- **Data Import:** Modus 2.0 Import System for step-by-step CSV data migration with validation, column mapping, and error reporting.
- **Geocoding:** Geoapify Geocoding API with Nominatim fallback.
- **Performance:** Database indexing, server-side pagination, optimized loading, and address search/autocomplete.
- **Real-time Capabilities:** Real-time Notifications (WebSocket) and Real-time GPS Position Tracking.
- **Offline Architecture:** Offline-first architecture for mobile field workers using IndexedDB.
- **Anomaly Monitoring:** Automatic background job for operational anomaly detection and alerts.
- **Customer Portal:** Enhanced self-service portal with authentication, order history, chat, self-booking, and documentation.
- **Scheduling & Reporting:** Flexible scheduling, dynamic structural articles, protocol/deviation report generation, Weekly Goal Progress Bars, Geoapify Routing API for distance calculations with Haversine fallback, and Auto-Fill Week functionality with Geographic Day-Clustering.
- **Distance Matrix Service:** Centralized caching for Geoapify Routing API calls.
- **Issue Reporting:** QR-code based public mobile web interface for anonymous issue reporting.
- **Environmental Statistics:** Tracking mileage, fuel, CO2, and generation of environmental certificates.
- **SMS Infrastructure:** Unified multi-channel notification service supporting email and SMS.
- **Route Feedback System:** Driver daily route ratings, reason categories, and reporting UI with KPI cards and charts, supported by an AI field assistant.
- **Planner Map:** Real-time driver/job map with filtering and status updates.
- **Historical Map View:** Playback of daily GPS movement patterns per resource.
- **Reporting & KPI Dashboard:** Enhanced `/reporting` page with tabs for various metrics and Recharts diagrams.
- **Work Sessions & Time Tracking (Snöret):** Complete work session management with check-in/check-out, time entries, and payroll CSV export.
- **Annual Planning (Årsplanering):** Annual goal tracking per customer/object with AI-driven optimal monthly work order distribution.
- **Equipment Sharing & Shift Collision Control:** Tracking vehicle/equipment bookings and collision detection.
- **Smart AI Kontrollmallar & Field Validation:** AI-driven control templates for field workers with mandatory field validation.
- **Invoice Preview/Generation & Fortnox Export:** Invoicing page with preview, filtering, batch selection, and Fortnox export.
- **Team Management & User Administration:** User management with CRUD, team system, bulk actions, and invitation system.
- **Företagsinställningar (Tenant Configuration):** Dedicated page for company setup, articles, execution codes, price lists, resources, permissions, and branded demo configuration.
- **Branded Demo Experience:** Quick branding editor in tenant settings with live preview and auto-scrape.
- **Fleet Management:** Comprehensive fleet management page with vehicle dashboard, maintenance planning, and fuel tracking.
- **IoT API & Automatic Order Generation:** Management of IoT devices, API keys, and auto-generation of work orders based on sensor signals.
- **Event-Driven Disruption Service:** Automated disruption detection, re-optimization suggestions, and a DisruptionPanel with real-time alerts.
- **Intelligent Break Placement in VRP:** Break constraints included in Geoapify Route Planner API VRP requests.
- **Feedback-loop — Beräknat vs Faktiskt:** Analytics comparing estimated vs actual service durations, with weekly accuracy trends and suggested duration adjustments.
- **Kundnotifieringar — Vi är på väg:** Automatic ETA notifications to customers with configurable margins, channels, and triggers. Includes LiveETAWidget in customer portal.
- **SlotPreference System:** Extended object time restrictions with `preference` and `reason` fields.
- **Planned Notes (Meddelande till utförare):** Planner can write messages to field workers displayed in the SimpleFieldApp.
- **Tenant Feature Flags:** Module-based feature packaging system with 4 tiers, allowing per-tenant module enablement.
- **WeekPlanner Drag-and-Drop Improvements:** Inline conflict indicators, multi-select bulk-move, and AI "Föreslå optimal tid" per order.
- **Smart Navigation i Fältappen:** Travel distance/time display per job card, "Nästa stopp" navigation card, and 10-minute timer warning.
- **Smart AI Resource Allocation:** AI-förslag button in JobModal suggests top 3 best-fit resources, competency warning, and "Auto-fördela idag" for unplanned orders.
- **Constraint Engine & Decision Trace:** Deterministic constraint validation for AI auto-schedule, risk score calculation, and `decisionTrace` logging.
- **Multi-Customer Billing (Flerkund-fakturering):** Extended `objectPayers` with `isPrimary` flag and `payerLabel` field.
- **Polyline/Polygon Support:** `polylineData` (GeoJSON) field on objects table for defining area boundaries, with editor component and bulk find-objects-in-polygon endpoint.
- **Map Cluster Selection Tool:** Draw polygon on objects map to spatially select objects and bulk-assign them to clusters.
- **Async Route Optimization:** `useRouteOptimization` hook with async job polling for route optimization status and results.
- **Adaptive GPS Tracking:** `useGpsTracking` with speed-adaptive interval and offline position buffer.
- **Enhanced Route Feedback (ML-ready):** Expanded reason options and auto-capture of actual vs planned metrics linked to `optimization_job_id` for ML.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Traivo optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **Mobile Field App API (Driver Core Integration):** Complete REST API for the Driver Core mobile field app with full Traivo GO compatibility layer.
- **Status Message Templates:** Configurable message templates with variable substitution for auto-responses.
- **Resource Availability Service:** Real-time resource schedule analysis computing next available time.
- **Portal Chat Auto-Responses:** Automatic status messages in customer portal chat when keywords are detected.

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
- **@react-native-community/netinfo:** Network connectivity detection for offline support.