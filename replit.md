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
The user interface features a sticky TopNav, global search, user utilities, a mobile-friendly hamburger menu, Floating Action Button, QuickStats dashboard cards, a drag-and-drop WeekPlanner, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Dedicated mobile interfaces for field technicians include a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help and progressive loading. White-label multi-tenant UI is supported with dynamic CSS variable injection, per-tenant color schemes, custom logos, font customization, and branding templates.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Full tenant isolation at database and API level with middleware, dynamic tenant selection, tenant ownership verification, and role-based access control.
- **MCP Server (Model Context Protocol):** Enables external AI assistants to interact with Unicorn data via SSE.
- **Modus 2.0 Import System:** Dedicated `/import` page for CSV imports with data transformation and validation.
- **Lazy Object Loading:** Performance optimization using custom hooks.
- **Address Search/Autocomplete:** Uses OpenStreetMap Nominatim API for Swedish address geocoding.
- **Real-time Notifications:** Token-based authenticated WebSocket push notifications.
- **Real-time GPS Position Tracking:** Tracks field resource locations with breadcrumb trails and real-time updates.
- **Offline Architecture:** Complete offline-first architecture for mobile field workers using IndexedDB for local caching, an outbox pattern for queuing updates, automatic synchronization, and visual offline indicators.
- **Automatic Anomaly Monitoring:** Background job detects operational anomalies and broadcasts alerts.
- **Mobile API Endpoints:** Dedicated endpoints for mobile login, resource/order retrieval, status updates, and note-taking.
- **Advanced Task & Object Features:** Includes tables for object images, contacts, desired timewindows, dependencies, and structural articles. Work orders support an 8-step execution status workflow, creation method tracking, what3words locations, and GPS coordinates.
- **Hierarchical Object Structure:** Customer-centric tree structure (`Koncern → BRF → Fastighet → Rum → Kärl`) with top-down data inheritance and configurable propagation rules.
- **Article Hook System:** Enables automatic article suggestions for objects based on hierarchy and conditions.
- **EAV Metadata System:** Flexible Entity-Attribute-Value system for object metadata, supporting various datatypes, inheritance, and tenant isolation.
- **Customer Portal 2.0:** Enhanced customer self-service portal with token-based magic link authentication, featuring upcoming visits, order history, visit confirmation, technician ratings, real-time chat, and self-booking.
- **Advanced Scheduling & Structural Articles:** Flexible scheduling with frequency metadata and dynamic structural articles supporting seasonal adjustments. Includes protocol and deviation report generation.
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting via QR codes, allowing GPS, photos, and conversion to work orders.
- **Environmental Statistics & Certificates:** Tracking of mileage, fuel, chemicals, CO2 calculations, and aggregated statistics. Includes annual environmental certificate generation with PDF export.
- **Metadata-triggers:** System for listing objects with deviations, tracking issue history, and categorizing problems.
- **Industry Packages System:** Predefined templates for different industries (Waste, Cleaning, Property services) including pre-configured articles, metadata definitions, structural articles, and one-click installation for new tenants.
- **SMS Infrastructure (Multi-channel Notifications):** Unified notification service supporting email and SMS (Twilio) with Swedish phone number normalization, per-tenant configuration, and test functionality.
- **Conversational AI Planner:** Natural language chat interface integrated into the week planner for intuitive planning interactions, using GPT-4o-mini for conversational queries, structured responses, and executable actions.
- **Weekly Goal Progress Bars (C6):** Three goal bars (Time/Economy/Count) in WeekPlanner header with color-coded thresholds (green ≥80%, yellow ≥50%, red <50%) showing live calculation from scheduled jobs.
- **Travel Time Calculation (C5):** Haversine-based travel time estimation between consecutive jobs. Yellow travel blocks in day timeline view with distance/time display, compact summaries in week view cells, and weekly travel total indicator in goal bars area.
- **Auto-Fill Week (C4 - Fyll Veckan):** Backend auto-planning endpoint (`/api/auto-plan-week`) with priority-based sorting, geographic clustering via Haversine distance, and capacity-aware assignment. Frontend dialog with overbooking tolerance slider (0-50%), preview table showing proposed assignments, and one-click apply with batch update.
- **API Cost Monitoring Dashboard:** Admin-only dashboard for real-time monitoring of all external API costs, including tracking of API calls, cost estimation, trend charts, per-service breakdown, per-tenant cost allocation, and budget management.
- **Execution Codes (C8 - Utforandekoder):** Many-to-many execution code system mapping resource capabilities to task requirements. Resources have `executionCodes` array, articles and work orders have `executionCode` field. Auto-plan enforces code matching. Frontend shows execution code abbreviations (KB, TV, SB, SV, BS, TR, MA) on job cards and provides execution code filter in orderstock sidebar.
- **Article Dependencies & Pickup Tasks (C7 - Beroendeartiklar):** Automatic pickup task generation for articles of type 'beroende'. Backend endpoint `/api/work-orders/:id/generate-pickup-tasks` creates linked work orders with calculated pickup dates based on `dependencyMinutesBefore`. Dependency chain visualization dialog accessible via link icons on job cards. Pickup tasks visually distinguished with amber badges.
- **Time Restrictions on Objects (C9 - Tidsbegransningar):** Object-level time restrictions (parking bans, emptying days, quiet hours, access restrictions) stored in `object_time_restrictions` table. Auto-plan skips restricted days. WeekPlanner shows red restriction warnings on job cards with tooltips, red day-level banners, and red-tinted week cells for restricted jobs. Unified conflict detection includes restriction checks during drag-and-drop.
- **Structural Tasks (C10 - Strukturuppgifter):** Composite tasks composed of multiple sub-steps using structural articles. Backend endpoints `/api/work-orders/:id/expand-structural` expands structural articles into child work orders, `/api/work-orders/:id/sub-steps` returns sub-step list with progress. Frontend SubStepsExpander on job cards shows expandable sub-step list with completion dots and progress counters.
- **Auto Metadata Writeback (C11):** When a work order's executionStatus changes to "completed", the system automatically writes metadata back to the object based on article configuration (leaveMetadataCode/leaveMetadataFormat). Supports timestamp, boolean_true, counter_increment, and default value formats. Logged with `auto:{workOrderId}` for audit trail.
- **Metadata Change History UI:** ObjectMetadataPanel includes a "Historik" button showing aggregated timeline of all metadata changes on an object. Color-coded by method (manuell=blue, ärvd=green, utförande=amber, auto=cyan). Individual metadata entries also have per-value history dialogs.
- **Orderkoncept System (Phase 1 & 2):** Scenario-based order automation with three modes: Avrop (on-demand), Schema (recurring with delivery schedule + time windows), and Abonnemang (subscription with monthly fee per unit). Phase 1 features: delivery schedule builder, rolling month generation, subscription calculation, change detection with approval workflow, preview endpoint. Phase 2 extensions: `washesPerYear` and `pricePerUnit` fields on order concepts, task dependency templates (article-level before/after/same_day dependencies with time offsets), invoice rules (per_task/per_room/per_area/monthly billing with metadata-driven fields), order concept run logs with change detection tracking, and rerun functionality. Frontend Phase 2 UI includes dependency template management dialog, invoice rule management dialog, run logs history dialog, and rerun button on concept rows. DB tables: `order_concepts`, `subscription_changes`, `task_dependency_templates`, `task_dependency_instances`, `invoice_rules`, `order_concept_run_logs`. API: `/api/order-concepts/:id/preview`, `/api/order-concepts/:id/run-rolling`, `/api/order-concepts/:id/rerun`, `/api/task-dependency-templates`, `/api/invoice-rules`, `/api/order-concept-run-logs`.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Unicorn optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **AI Strategy:** Utilizes OpenAI (gpt-4o-mini for quick analyses, gpt-4o for complex decisions) via Replit AI Integrations with context-driven prompting and structured JSON output. Integrated AI Cards (AICard) provide context-aware suggestions, and an AI Planning Assistant optimizes weekly planning, drive time, and order prioritization. AI Auto-Scheduling incorporates 7-day weather forecasts to adjust capacity and group orders.

## External Dependencies
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interactions.
- **OpenAI API:** AI planning suggestions (via Replit AI Integrations).
- **OpenRouteService:** Route visualization.
- **OpenStreetMap Nominatim:** Geocoding for Swedish addresses.
- **External Unicorn Optimization Service:** Dedicated route optimization service.
- **DataClean Service:** External service for data validation and geocoding.
- **Modus 2.0:** Source of CSV data for imports.
- **react-leaflet:** Interactive map visualizations.
- **shadcn/ui:** UI component library.
- **Open-Meteo API:** Provides weather forecast data for AI auto-scheduling.
- **Fortnox API:** Integration with the Fortnox accounting system.
- **Resend:** Email notification service.
- **Twilio API:** SMS notification service.
- **jsPDF:** PDF generation library.