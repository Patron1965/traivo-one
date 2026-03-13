# Nordnav One - AI-Driven Field Service Planning Platform

## Overview
Nordnav One is an AI-driven platform designed to optimize field service operations for Nordic companies, starting with waste management. It aims to transition from manual management to AI-driven optimization, providing real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's ambition is to become the standard platform for Nordic field service, scaling into a commercial SaaS solution with full flerföretagsstöd (multi-tenant).

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic — Nordnav One Color Palette: Deep Ocean Blue (#1B4B6B), Arctic Ice (#E8F4F8), Mountain Gray (#6B7C8C), Northern Teal (#4A9B9B), Midnight Navy (#2C3E50), Aurora Green (#7DBFB0)
- **Logo:** `@assets/nordnav_one_logo_final_upward_1773311964126.png`
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## System Architecture
The Nordnav One platform is a functional prototype built with a modern web stack, emphasizing a clean Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The user interface includes a sticky TopNav, global search, user utilities, a mobile-friendly hamburger menu, Floating Action Button, QuickStats, a drag-and-drop WeekPlanner, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces for field technicians feature a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help, progressive loading, white-label multi-tenancy, and an AI Command Center. An interactive Tour Guide system provides step-by-step onboarding, and role-based navigation filtering ensures relevant options are displayed.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Full tenant isolation at database and API level with middleware and role-based access control.
- **AI Integration:** AI-first approach with OpenAI (gpt-4o-mini, gpt-4o) for AI Cards, AI Planning Assistant, AI Auto-Scheduling, and a Conversational AI Planner.
- **MCP Server:** Enables external AI assistants to interact with Nordfield data via SSE.
- **Modus 2.0 Import System:** Dedicated `/import` page for step-by-step data migration from Modus 2.0 via CSV, supporting objects, tasks, invoice lines, and events. Features include upsert logic, pre-import validation, batch tracking, and SSE-based real-time progress feedback.
- **Geoapify Geocoding Integration:** Address resolution via Geoapify Geocoding API (replaced Google Geocoding to eliminate costs), with fallback to Nominatim. Used for precise distance calculations in route optimization.
- **Performance:** Database indexes, server-side pagination, optimized WeekPlanner loading, lazy object loading, and Address Search/Autocomplete with Geoapify Geocoding and OpenStreetMap Nominatim fallback.
- **Real-time Capabilities:** Real-time Notifications (WebSocket) and Real-time GPS Position Tracking.
- **Offline Architecture:** Complete offline-first architecture for mobile field workers using IndexedDB.
- **Automatic Anomaly Monitoring:** Background job for detecting operational anomalies and broadcasting alerts.
- **Mobile API Endpoints:** Dedicated REST API for mobile features including login, order/resource retrieval, status updates, notes, deviations, material logging, signature, inspection, GPS tracking, weather, AI chat, transcription, and image analysis, with offline sync capabilities.
- **Checklist Templates:** Article-type-based inspection checklist templates with admin CRUD.
- **Driver Push Notifications:** Persistent notification storage with REST polling and WebSocket integration.
- **Advanced Task & Object Features:** Hierarchical object structure, article hook system, EAV metadata, multi-parent relations, comprehensive work order management, and per-object article management with resolved pricing.
- **Customer Portal 2.0:** Enhanced self-service portal with token-based authentication, featuring upcoming visits, order history, real-time chat, and self-booking. Configurable portal booking options (service types, time slots, request types) stored in tenant settings JSONB with admin API (`GET/PUT /api/portal-booking-config`), server-side enforcement on `POST /api/portal/self-bookings`, and dynamic `SelfBookingWidget` that fetches options from `/api/portal/booking-options`.
- **Scheduling & Reporting:** Flexible scheduling with frequency metadata, dynamic structural articles, protocol/deviation report generation, Weekly Goal Progress Bars, Haversine-based Travel Time Calculation, and Auto-Fill Week functionality with cluster-aware resource assignment.
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting.
- **Environmental Statistics & Certificates:** Tracking mileage, fuel, CO2, and generation of annual environmental certificates.
- **Metadata-triggers:** System for listing objects with deviations and tracking issue history.
- **Industry Packages System:** Predefined templates for different industries with configurable articles and metadata.
- **SMS Infrastructure:** Unified multi-channel notification service supporting email and SMS.
- **Planner Map (`/planner/map`):** Real-time driver/job map with real road geometry via Geoapify, per-route filtering, status filter chips, enhanced job popups, colored driver avatars, and route information.
- **Historical Map View:** Playback of daily GPS movement patterns per resource with timeline slider and KPI overlay.
- **API Cost Monitoring Dashboard:** Admin-only dashboard for real-time monitoring of external API costs.
- **Reporting & KPI Dashboard:** Enhanced `/reporting` page with tabs for overview, productivity, completion, deviations, resources, areas, and customers, featuring Recharts diagrams.
- **Execution Codes:** Many-to-many system mapping resource capabilities to task requirements.
- **Resource Profiles (Utföranderoller):** Profile templates defining execution codes, equipment types, cost center, project code, and service areas. Profiles are assigned to resources and used in auto-planning capability matching. Admin UI in TenantConfigPage "Utföranderoller" tab. WeekPlanner resource filter includes profile-based quick filtering. Teams can be linked to profiles via `teams.profileIds` — team members automatically inherit profile execution codes for auto-planning capability matching. Team profile assignment UI in UserManagementPage team dialog.
- **Work Sessions & Time Tracking (Snöret):** Complete work session management system at `/work-sessions` with `workSessions` and `workEntries` tables. Features include check-in/check-out, time entries by type (work/travel/setup/break/rest), weekly time summaries with progress bars, night rest (<11h) and weekly rest (<36h) labor rule violation detection, and payroll CSV export. API: GET/POST/PUT/DELETE `/api/work-sessions`, `/api/work-entries`, plus `/api/time-summary` and `/api/payroll-export`.
- **Article Dependencies & Pickup Tasks:** Automatic pickup task generation for dependent articles.
- **Time Restrictions:** Object-level time restrictions impacting auto-planning and WeekPlanner.
- **Structural Tasks:** Composite tasks composed of multiple sub-steps.
- **Auto Metadata Writeback & Change History:** Automatic metadata updates and UI for viewing change history.
- **Orderkoncept System:** Scenario-based order automation (Avrop, Schema, Abonnemang) with a 9-step wizard for building delivery schedules and subscription calculations.
- **Field Worker Task Dependency View:** Mobile app displays task dependencies.
- **Field Worker Photo Upload:** Two-step presigned URL flow for photo capture.
- **Inspection & Metadata System:** Structured inspection checklist integrated into the mobile app.
- **Invoice Preview/Generation & Fortnox Export:** Full invoicing page at `/invoicing` with preview, filtering, batch selection, Fortnox export, and export history.
- **Team Management & User Administration:** User management page at `/user-management` with admin CRUD for users, team system, and bulk actions.
- **Företagsinställningar (Tenant Configuration):** Dedicated `/tenant-config` page for company setup, articles, execution codes, price lists, resources, and permissions.
- **Fleet Management:** Comprehensive fleet management page at `/fleet` with vehicle dashboard, maintenance planning, and fuel tracking.
- **Tenant Onboarding Wizard:** Admin wizard at `/onboarding` for creating new company accounts with industry package selection.
- **Multi-Strategy Auto-Clustering:** Enhanced `/auto-cluster` page with 5 strategies for automatic cluster generation, including smart auto-assignment and manual cluster movement.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Nordfield optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **Mobile Field App API (Driver Core Integration):** Complete REST API for the Driver Core mobile field app.

## External Dependencies
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interactions.
- **OpenAI API:** AI planning suggestions, conversational AI.
- **Geoapify:** Route calculation (Routing API) and VRP optimization (Route Planner API).
- **OpenStreetMap Nominatim:** Geocoding for Swedish addresses.
- **External Nordfield Optimization Service:** Dedicated route optimization.
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