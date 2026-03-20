# Traivo - AI-Driven Field Service Planning Platform

## Overview
Traivo is an AI-driven platform designed to optimize field service operations for Nordic companies, initially focusing on waste management. Its purpose is to transition from manual management to AI-driven optimization, providing real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project aims to become the standard platform for Nordic field service, scaling into a commercial SaaS solution with full multi-tenant support.

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
The user interface features a sticky TopNav, global search, mobile-friendly hamburger menu, Floating Action Button, QuickStats, a drag-and-drop WeekPlanner, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces include a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, and role-based navigation filtering.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js with modular route architecture.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Full tenant isolation at database and API level with middleware and role-based access control.
- **AI Integration:** AI-first approach with OpenAI for AI Cards, AI Planning Assistant, AI Auto-Scheduling, and a Conversational AI Planner.
- **Modus 2.0 Import System:** Dedicated import page for step-by-step CSV data migration with validation, real-time progress, and Data Health Scorecard.
- **Geoapify Geocoding Integration:** Address resolution via Geoapify Geocoding API with Nominatim fallback.
- **Performance:** Database indexes, server-side pagination, optimized loading, lazy object loading, and address search/autocomplete.
- **Real-time Capabilities:** Real-time Notifications (WebSocket) and Real-time GPS Position Tracking.
- **Offline Architecture:** Complete offline-first architecture for mobile field workers using IndexedDB.
- **Automatic Anomaly Monitoring:** Background job for detecting operational anomalies and broadcasting alerts.
- **Mobile API Endpoints:** Dedicated REST API for mobile features including login, order/resource retrieval, status updates, notes, deviations, material logging, signature, inspection, GPS tracking, weather, AI chat, transcription, and image analysis, with offline sync capabilities.
- **Advanced Task & Object Features:** Hierarchical object structure, article hook system, EAV metadata, multi-parent relations, comprehensive work order management, and per-object article management with resolved pricing.
- **Customer Portal 2.0:** Enhanced self-service portal with token-based authentication, featuring upcoming visits, order history, real-time chat, self-booking, and dynamic widgets.
- **Scheduling & Reporting:** Flexible scheduling with frequency metadata, dynamic structural articles, protocol/deviation report generation, Weekly Goal Progress Bars, Haversine-based Travel Time Calculation, and Auto-Fill Week functionality with cluster-aware resource assignment.
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting.
- **Environmental Statistics & Certificates:** Tracking mileage, fuel, CO2, and generation of annual environmental certificates.
- **Industry Packages System:** Predefined templates for different industries with configurable articles and metadata.
- **SMS Infrastructure:** Unified multi-channel notification service supporting email and SMS.
- **Route Feedback System:** Driver daily route ratings, reason categories, free text, and reporting UI with KPI cards and charts. AI field assistant tool for querying feedback data.
- **Planner Map (`/planner/map`):** Real-time driver/job map with real road geometry via Geoapify, per-route filtering, status filter chips, enhanced job popups, colored driver avatars, and route information.
- **Historical Map View:** Playback of daily GPS movement patterns per resource with timeline slider and KPI overlay.
- **API Cost Monitoring Dashboard:** Admin-only dashboard for real-time monitoring of external API costs, with AI budget status card showing current usage, monthly budget, forecast, and threshold indicators (green/yellow/orange/red).
- **AI Budget Enforcement:** Per-tenant budget enforcement service (`server/ai-budget-service.ts`) with budget status check (30s cache), threshold alerts at 50/80/95/100%, sliding-window rate limiting (Standard=50/hr, Premium=200/hr), model resolver per tier, concurrency lock for auto-scheduling, retry with exponential backoff (3 attempts), and AI response cache (15min TTL). Budget guard middleware on all major AI endpoints blocks requests at 100% usage. `budgetAlertLog` table prevents duplicate threshold alerts. Thread-safe per-request model/tenant context via `AsyncLocalStorage` in `ai-planner.ts` (`runWithAIContext`).
- **Reporting & KPI Dashboard:** Enhanced `/reporting` page with tabs for overview, productivity, completion, deviations, resources, areas, and customers, featuring Recharts diagrams.
- **Execution Codes & Resource Profiles:** System for mapping resource capabilities to task requirements, and profile templates defining execution codes, equipment, cost centers, project codes, and service areas for auto-planning.
- **Work Sessions & Time Tracking (Snöret):** Complete work session management system with check-in/check-out, time entries, weekly time summaries, labor rule violation detection, and payroll CSV export.
- **Annual Planning (Årsplanering):** Annual goal tracking per customer/object with AI-driven distribution proposing optimal monthly work order distribution using OpenAI, respecting season restrictions and resource capacity.
- **Equipment Sharing & Shift Collision Control:** Tracking vehicle/equipment bookings, collision detection, and availability timeline.
- **Article Dependencies & Pickup Tasks:** Automatic pickup task generation for dependent articles.
- **Time Restrictions:** Object-level time restrictions impacting auto-planning and WeekPlanner.
- **Structural Tasks:** Composite tasks composed of multiple sub-steps.
- **Auto Metadata Writeback & Change History:** Automatic metadata updates and UI for viewing change history.
- **Orderkoncept System:** Scenario-based order automation (Avrop, Schema, Abonnemang) with a 9-step wizard for building delivery schedules and subscription calculations.
- **Smart AI Checklist & Field Validation:** AI-driven checklist for field workers suggesting steps based on order type and history from similar jobs. Technicians can check off steps, add custom steps, and the system auto-saves. Before signing/completing, mandatory field validation per order type blocks completion if required fields (photos, signature, inspection, materials, description) are missing, showing a modal with the list of missing items.
- **Field Worker Task Dependency View & Photo Upload:** Mobile app displays task dependencies and supports two-step presigned URL photo uploads.
- **Invoice Preview/Generation & Fortnox Export:** Full invoicing page with preview, filtering, batch selection, Fortnox export, and export history.
- **Team Management & User Administration:** User management with admin CRUD, team system, bulk actions, and invitation system.
- **Access Control & Invitations:** Frontend access gate and admin invitation system for pre-approving users with role assignment.
- **Företagsinställningar (Tenant Configuration):** Dedicated `/tenant-config` page for company setup, articles, execution codes, price lists, resources, permissions, and branded demo configuration.
- **Branded Demo Experience:** Quick branding editor in tenant settings with live preview and auto-scrape feature for extracting branding from prospect websites.
- **Fleet Management:** Comprehensive fleet management page with vehicle dashboard, maintenance planning, and fuel tracking.
- **Tenant Onboarding Wizard:** Admin wizard for creating new company accounts with industry package selection.
- **Multi-Strategy Auto-Clustering:** Enhanced `/auto-cluster` page with 5 strategies for automatic cluster generation.
- **Interim Objects & Object Verification:** `isInterimObject` flag for public issue reports with admin UI for verification.
- **IoT API & Automatic Order Generation:** Management of IoT devices, API keys, and signals, with auto-generation of work orders based on sensor signals.
- **Predictive Maintenance (`/predictive-maintenance`):** AI-driven predictive maintenance using IoT signal history to forecast next service date with confidence scoring.
- **ROI-rapport (`/roi-report`):** Generalized ROI report per customer calculated from real usage data.
- **SlotPreference System:** Extended object time restrictions with `preference` and `reason` fields, UI for visualization, and aggregated preferences for order placement.
- **Job Creation Price List Override:** Optional price list selector in JobModal allowing manual override of automatic price resolution hierarchy.
- **Planned Notes (Meddelande till utförare):** Planner can write messages to field workers when creating jobs, displayed prominently in the SimpleFieldApp.
- **Tenant Feature Flags (Funktionsflaggor per tenant):** Module-based feature packaging system with 4 tiers (Bas/Standard/Premium/Anpassad). `tenantFeatures` DB table stores per-tenant enabled modules. Backend cache with 60s TTL in `server/feature-flags.ts`. Frontend `FeatureProvider` context filters navigation and gates routes via `ProtectedRoute`. "Moduler" tab in TenantConfigPage for package selection and per-module toggles. Shared definitions in `shared/modules.ts`.
- **WeekPlanner Drag-and-Drop Improvements:** Inline conflict indicators during drag-over (red outline + AlertTriangle warning on DroppableCell before drop), multi-select bulk-move (checkbox UI on JobCards, bulk drag to target cell with sequential scheduling), and AI "Föreslå optimal tid" per order (scoring algorithm endpoint `POST /api/ai/suggest-placement` with proximity/capacity/area scoring, popover UI in UnscheduledSidebar showing top 3 suggestions).
- **Constraint Engine & Decision Trace:** Deterministic constraint validation layer (`server/planning/constraintEngine.ts`) validates AI auto-schedule against hard constraints (locked orders, dependency chains, time windows, resource availability, vehicle schedules) and soft constraints (capacity overload). Risk score calculator (`server/planning/riskCalculator.ts`) computes 0–1 risk from missing data, access codes, resource history, and weather variance. `/api/ai/auto-schedule` response includes `decisionTrace` with `summary` (KPI deltas), `moves` (from/to with reasons, confidence, constraintStatus), `constraintViolations`, and `riskFactors`. All decisions logged to `planning_decision_log` table for audit trail.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Traivo optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **Mobile Field App API (Driver Core Integration):** Complete REST API for the Driver Core mobile field app.

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
- **Fortnox API:** Integration with the Fortnox accounting system for entity import and export.
- **Resend:** Email notification service.
- **Twilio API:** SMS notification service.
- **jsPDF:** PDF generation library.
- **Replit Object Storage:** Photo uploads and file storage.