# Unicorn - AI-Driven Field Service Planning Platform

## Overview
Unicorn is an AI-driven platform designed to optimize field service operations for Nordic companies, starting with waste management. It aims to transition from manual management to AI-driven optimization, providing real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's ambition is to become the standard platform for Nordic field service, scaling into a commercial multi-tenant SaaS solution.

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## System Architecture
The Unicorn platform is a functional prototype built with a modern web stack, emphasizing a clean Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The user interface features a sticky TopNav, global search, user utilities, a mobile-friendly hamburger menu, Floating Action Button, QuickStats dashboard cards, a drag-and-drop WeekPlanner (with capacity-aware color-coded drop zones, auto time-slot assignment, time window badges, and weekly resource utilization summaries), RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Dedicated mobile interfaces for field technicians include a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help and progressive loading. White-label multi-tenant UI is supported with dynamic CSS variable injection, per-tenant color schemes, custom logos, font customization, and branding templates. An AI Command Center provides a unified dashboard for AI features.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Full tenant isolation at database and API level with middleware, dynamic tenant selection, tenant ownership verification, and role-based access control.
- **AI Integration:** AI-first approach with OpenAI (gpt-4o-mini for quick analyses, gpt-4o for complex decisions) via Replit AI Integrations. Includes AI Cards for context-aware suggestions, an AI Planning Assistant, and AI Auto-Scheduling considering weather forecasts. Conversational AI Planner with natural language chat interface and function-calling capabilities.
- **MCP Server (Model Context Protocol):** Enables external AI assistants to interact with Unicorn data via SSE.
- **Modus 2.0 Import System:** Dedicated `/import` page for CSV imports with data transformation and validation.
- **Performance:** Lazy Object Loading, Address Search/Autocomplete (OpenStreetMap Nominatim).
- **Real-time Capabilities:** Real-time Notifications (WebSocket), Real-time GPS Position Tracking for field resources.
- **Offline Architecture:** Complete offline-first architecture for mobile field workers using IndexedDB, outbox pattern, and automatic synchronization.
- **Automatic Anomaly Monitoring:** Background job detects operational anomalies and broadcasts alerts.
- **Mobile API Endpoints:** Dedicated REST API for mobile login, resource/order retrieval, status updates, note-taking, deviation reporting, material logging, signature capture, inspection submission, GPS tracking, weather, AI chat, transcription, and image analysis. Includes offline sync batch endpoint, sync status tracking, and enriched API responses with sync/notification counts.
- **Checklist Templates:** Article-type-based inspection checklist templates. Admin CRUD UI at `/checklist-templates`. Mobile API auto-matches relevant checklists per work order's article type via `GET /api/mobile/orders/:id/checklist`.
- **Driver Push Notifications:** Persistent notification storage with REST polling endpoints (`GET /api/mobile/notifications`, `PATCH /read`, `/read-all`, `/count`). Integrated with existing WebSocket notification service for real-time delivery + offline persistence.
- **Advanced Task & Object Features:** Includes hierarchical object structure (`Koncern → BRF → Fastighet → Rum → Kärl`), article hook system for automatic suggestions, EAV metadata system, and comprehensive work order management (8-step workflow, what3words, GPS).
- **Customer Portal 2.0:** Enhanced customer self-service portal with token-based magic link authentication, featuring upcoming visits, order history, real-time chat, and self-booking.
- **Scheduling & Reporting:** Flexible scheduling with frequency metadata, dynamic structural articles, protocol/deviation report generation. Includes Weekly Goal Progress Bars, Haversine-based Travel Time Calculation, and Auto-Fill Week functionality with priority-based sorting and geographic clustering.
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting.
- **Environmental Statistics & Certificates:** Tracking of mileage, fuel, CO2, and generation of annual environmental certificates.
- **Metadata-triggers:** System for listing objects with deviations and tracking issue history.
- **Industry Packages System:** Predefined templates for different industries with configurable articles, metadata, and one-click installation for new tenants.
- **SMS Infrastructure:** Unified multi-channel notification service supporting email and SMS.
- **Historical Map View:** Playback of daily GPS movement patterns per resource with timeline slider, speed control, and KPI overlay. Located at `/historical-map`.
- **KPI Dashboard on Map:** Real-time daily KPI overlay (completed/remaining tasks, average time, completion rate) on the historical map view.
- **Automatic Weekly Reports:** Scheduled Friday email reports via Resend with weekly KPIs, trend comparisons, and per-tenant summaries.
- **API Cost Monitoring Dashboard:** Admin-only dashboard for real-time monitoring of external API costs.
- **Reporting & KPI Dashboard:** Enhanced `/reporting` page with 7 tabs (Översikt, Produktivitet, Slutförda, Avvikelser, Resurser, Områden, Kunder). Includes Recharts diagrams for productivity trends (planned vs actual time, efficiency), completion analysis (cumulative rate, per-priority, per-resource), and deviation statistics (trend, category distribution, severity pie, status breakdown, recent list). Deviation data fetched from `/api/deviation-reports`.
- **Execution Codes:** Many-to-many system mapping resource capabilities to task requirements, enforced by auto-planning.
- **Article Dependencies & Pickup Tasks:** Automatic pickup task generation for dependent articles.
- **Time Restrictions:** Object-level time restrictions impacting auto-planning and WeekPlanner visualization.
- **Structural Tasks:** Composite tasks composed of multiple sub-steps.
- **Auto Metadata Writeback & Change History:** Automatic metadata updates on work order completion and UI for viewing metadata change history.
- **Orderkoncept System:** Scenario-based order automation (Avrop, Schema, Abonnemang) with delivery schedule builder, subscription calculation, and change detection.
- **Field Worker Task Dependency View:** Mobile app displays task dependencies.
- **Field Worker Photo Upload:** Two-step presigned URL flow for photo capture.
- **Inspection & Metadata System:** Structured inspection checklist integrated into the mobile app with a dedicated search page for results.
- **Invoice Preview/Generation & Fortnox Export:** Backend endpoint for invoice previews and batch export to Fortnox.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Unicorn optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **Mobile Field App API (Driver Core Integration):** Complete REST API for the Driver Core mobile field app (React Native/Expo).

## External Dependencies
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interactions.
- **OpenAI API:** AI planning suggestions, conversational AI.
- **OpenRouteService:** Route visualization.
- **OpenStreetMap Nominatim:** Geocoding for Swedish addresses.
- **External Unicorn Optimization Service:** Dedicated route optimization.
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