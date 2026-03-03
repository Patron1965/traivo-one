# Unicorn - AI-Driven Field Service Planning Platform

## Overview
Unicorn is an AI-driven platform designed to optimize field service operations for Nordic companies, starting with waste management. It aims to transition from manual management to AI-driven optimization, providing real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's ambition is to become the standard platform for Nordic field service, scaling into a commercial SaaS solution with full flerföretagsstöd (multi-tenant).

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## System Architecture
The Unicorn platform is a functional prototype built with a modern web stack, emphasizing a clean Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The user interface features a sticky TopNav, global search, user utilities, a mobile-friendly hamburger menu, Floating Action Button, QuickStats dashboard cards, a drag-and-drop WeekPlanner, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Dedicated mobile interfaces for field technicians include a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help, progressive loading, and white-label multi-tenancy with dynamic CSS, custom logos, and branding templates. An AI Command Center provides a unified dashboard for AI features. An interactive Tour Guide system provides step-by-step onboarding with spotlight overlay, tooltip navigation, and multiple tour definitions. Role-based navigation filtering ensures users only see relevant options.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy (Flerföretagsstöd):** Full tenant isolation at database and API level with middleware, dynamic tenant selection, and role-based access control.
- **AI Integration:** AI-first approach with OpenAI (gpt-4o-mini, gpt-4o) via Replit AI Integrations. Includes AI Cards, an AI Planning Assistant, AI Auto-Scheduling, and a Conversational AI Planner with natural language chat.
- **MCP Server:** Enables external AI assistants to interact with Unicorn data via SSE.
- **Modus 2.0 Import System:** Dedicated `/import` page for step-by-step data migration from Modus 2.0 via CSV, supporting 4 data types: Objects (with type mapping: Miljökärl→miljokarl, Miljörum→rum, Underjordsbehållare→underjord, Fastighet/Byggnad→fastighet, empty→omrade), Tasks/Uppgiftshändelser (Kärltvätt/Rumstvätt/Tvätt UJ-behållare with full field import including Prislista, Kostnad, Pris, Fakturerad, Resultat, Jobb, Beställning), Invoice Lines/Fakturarader (auto-creates articles from Fortnox Artikel Id K100/UJ100, comma-decimal price parsing), and Events/Uppgifter (time analysis). Enhanced with: upsert logic (duplicate detection via objectNumber/modusId), pre-import validation endpoint with typeStats/emptyTypeCount/parentWithSpaces warnings, parent-ID whitespace stripping (.replace(/\s/g, "")), import batch tracking (`importBatchId` on objects/customers/workOrders), batch undo capability (`DELETE /api/import/batch/:batchId`) covering work order lines cascade, SSE-based real-time progress feedback during async background import (tenant-scoped), and import history UI with per-batch undo.
- **Performance:** Lazy Object Loading, Address Search/Autocomplete (OpenStreetMap Nominatim).
- **Real-time Capabilities:** Real-time Notifications (WebSocket), Real-time GPS Position Tracking.
- **Offline Architecture:** Complete offline-first architecture for mobile field workers using IndexedDB and outbox pattern.
- **Automatic Anomaly Monitoring:** Background job detects operational anomalies and broadcasts alerts.
- **Mobile API Endpoints:** Dedicated REST API for mobile features including login, order/resource retrieval, status updates, notes, deviations, material logging, signature, inspection, GPS tracking, weather, AI chat, transcription, and image analysis, with offline sync capabilities.
- **Checklist Templates:** Article-type-based inspection checklist templates with admin CRUD and mobile API integration.
- **Driver Push Notifications:** Persistent notification storage with REST polling endpoints and WebSocket integration.
- **Advanced Task & Object Features:** Hierarchical object structure, article hook system, EAV metadata, multi-parent relations, comprehensive work order management, and per-object article management with resolved pricing (manual article links via `object_articles` table, price override support, price resolution from price lists).
- **Customer Portal 2.0:** Enhanced self-service portal with token-based authentication, featuring upcoming visits, order history, real-time chat, and self-booking.
- **Scheduling & Reporting:** Flexible scheduling with frequency metadata, dynamic structural articles, protocol/deviation report generation, Weekly Goal Progress Bars, Haversine-based Travel Time Calculation, and Auto-Fill Week functionality.
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting.
- **Environmental Statistics & Certificates:** Tracking of mileage, fuel, CO2, and generation of annual environmental certificates.
- **Metadata-triggers:** System for listing objects with deviations and tracking issue history.
- **Industry Packages System:** Predefined templates for different industries with configurable articles and metadata.
- **SMS Infrastructure:** Unified multi-channel notification service supporting email and SMS.
- **Historical Map View:** Playback of daily GPS movement patterns per resource with timeline slider and KPI overlay.
- **KPI Dashboard on Map:** Real-time daily KPI overlay on the historical map view.
- **Automatic Weekly Reports:** Scheduled email reports with weekly KPIs and trend comparisons.
- **API Cost Monitoring Dashboard:** Admin-only dashboard for real-time monitoring of external API costs.
- **Reporting & KPI Dashboard:** Enhanced `/reporting` page with tabs for overview, productivity, completion, deviations, resources, areas, and customers, featuring Recharts diagrams.
- **Execution Codes:** Many-to-many system mapping resource capabilities to task requirements.
- **Article Dependencies & Pickup Tasks:** Automatic pickup task generation for dependent articles.
- **Time Restrictions:** Object-level time restrictions impacting auto-planning and WeekPlanner, with support for period-based and recurring patterns.
- **Structural Tasks:** Composite tasks composed of multiple sub-steps.
- **Auto Metadata Writeback & Change History:** Automatic metadata updates and UI for viewing change history.
- **Orderkoncept System:** Scenario-based order automation (Avrop, Schema, Abonnemang) with delivery schedule builder and subscription calculation.
- **Field Worker Task Dependency View:** Mobile app displays task dependencies.
- **Field Worker Photo Upload:** Two-step presigned URL flow for photo capture.
- **Inspection & Metadata System:** Structured inspection checklist integrated into the mobile app with a dedicated search page.
- **Invoice Preview/Generation & Fortnox Export:** Full invoicing page at `/invoicing` with preview, filtering, batch selection, Fortnox export, and export history. Includes invoice stop-level logic for correct recipient determination.
- **Team Management & User Administration:** User management page at `/user-management` with admin CRUD for users and a team system for grouping resources.
- **Företagsinställningar (Tenant Configuration):** Dedicated `/tenant-config` page for company setup, articles, execution codes, price lists, resources, and permissions.
- **Fleet Management:** Comprehensive fleet management page at `/fleet` with vehicle dashboard, maintenance planning, and fuel tracking.
- **Tenant Onboarding Wizard:** Admin wizard at `/onboarding` for creating new company accounts with industry package selection and admin user creation.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Unicorn optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **Mobile Field App API (Driver Core Integration):** Complete REST API for the Driver Core mobile field app.

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