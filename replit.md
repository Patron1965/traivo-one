# Unicorn - AI-Driven Field Service Planning Platform

## Overview
Unicorn is an AI-driven planning platform designed to optimize field service operations for Nordic companies, starting with waste management. The platform aims to transition from manual management to AI-driven optimization, offering real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's ambition is to become the standard platform for Nordic field service, initially proving value with Kinab AB and then scaling into a commercial multi-tenant SaaS solution.

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic
- **Theme:** Dark/light mode support
- **Font:** Inter for UI
- **Development:** Alla nya funktioner ska alltid läggas till i frontend med navigeringslänkar - användaren vill se helheten och vad som byggs under skalet

## System Architecture
The Unicorn platform is a functional prototype built with a modern web stack, emphasizing a clean Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The user interface includes a sticky TopNav, global search, user utilities, and a mobile-friendly hamburger menu. Key components are a Floating Action Button, QuickStats dashboard cards, a drag-and-drop WeekPlanner, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Dedicated mobile interfaces for field technicians feature a MobileFieldApp with large buttons, SignatureCapture, MaterialLog with autocomplete for Nordic waste items, and a JobProtocolGenerator for automatic PDF reporting. The UI supports contextual help with `HelpTooltip` and `PageHelp` components, and implements progressive loading using skeleton placeholders.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Full tenant isolation at database and API level with:
  - Tenant middleware (`server/tenant-middleware.ts`) validates user-tenant membership
  - All API routes use dynamic tenant from user session
  - Tenant ownership verification on all read/update/delete endpoints (106+ verifyTenantOwnership checks)
  - Role-based access control (owner, admin, user) for administrative endpoints
  - Users must be explicitly assigned to tenants by administrators
- **MCP Server (Model Context Protocol):** Enables external AI assistants to interact with Unicorn data via SSE.
- **Modus 2.0 Import System:** Dedicated `/import` page for CSV imports with data transformation and validation.
- **Lazy Object Loading:** Performance optimization using `useObjectsByIds` and `useObjectSearch` hooks.
- **Address Search/Autocomplete:** Uses OpenStreetMap Nominatim API for Swedish address geocoding.
- **Real-time Notifications (WebSocket):** Token-based authenticated push notifications for field workers and system-wide broadcasts.
- **Real-time GPS Position Tracking:** Tracks field resource locations with breadcrumb trails, storing history and providing real-time updates via WebSocket and HTTP fallback.
- **Automatic Anomaly Monitoring:** Background job detects operational anomalies (e.g., stale positions, delayed orders) and broadcasts alerts.
- **Mobile API Endpoints:** Dedicated endpoints for mobile login, resource/order retrieval, status updates, and note-taking.
- **Advanced Task & Object Features:** Includes tables for object images, object contacts (with inheritance), task desired timewindows, task dependencies, task information, and structural articles. Work orders now support an 8-step execution status workflow, creation method tracking, what3words locations, and GPS coordinates for execution.

### Feature Specifications
- **Clusters:** Core concept representing **customer-based hierarchy with data inheritance**, not primarily geographic groupings. The customer sits at the top of the tree structure, and data flows downward through the hierarchy. Geographic coordinates (geocoding) are added later during route optimization, not at cluster creation. Visualized with lists and interactive maps.
- **Order Management:** Comprehensive workflow with status tracking, cost/value tracking, and simulation.
- **Pricing System:** Three-tier hierarchy (general, customer, discount letter) for articles and services.
- **Fleet & Resource Management:** Tracking of vehicles, equipment, resource allocation with competencies, and availability scheduling.
- **Subscription Management:** Handles recurring services and automatic order generation.
- **Planning Parameters:** Configuration of SLA levels and time slots.
- **Hierarchical Object Structure:** Customer-centric tree structure: `Koncern → BRF → Fastighet → Rum → Kärl` (Corporate → Housing Association → Property → Room → Container). Data inheritance flows top-down with configurable propagation rules:
  - **Fixed (fast):** Values that never change or inherit
  - **Falling (fallande):** Values inherited from parent unless explicitly overridden at child level
  - **Dynamic (dynamisk):** Values calculated at runtime based on context
- **Article Hook System:** Enables automatic article suggestions for objects based on their hierarchy level and conditions (e.g., container types, access codes).
- **Fortnox Integration:** Full integration with the Fortnox accounting system, including OAuth, entity mapping (cost centers, projects, customers, articles), and an invoice export pipeline with multi-payer support and error handling.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Unicorn optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **AI Strategy:** Utilizes OpenAI (gpt-4o-mini for quick analyses, gpt-4o for complex decisions) via Replit AI Integrations with context-driven prompting and structured JSON output. Integrated AI Cards (AICard) provide context-aware suggestions on pages, and an AI Planning Assistant optimizes weekly planning, drive time, and order prioritization. AI Auto-Scheduling incorporates 7-day weather forecasts from Open-Meteo API to adjust capacity and group orders.

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

## Development Progress

### Sprint 1 (Completed)
- Full order concept and assignment system with 8-step status workflow
- 9-operator filter management for advanced filtering

### Sprint 2 (Completed)
- Intelligent task generation with economic calculations
- Execute endpoint calculates cachedValue, cachedCost, estimatedDuration from article data
- Frontend displays economic summary cards, value column in table, and detailed breakdown

### Sprint 3 (Completed)
- Resource scheduling and management features
- Candidate resource endpoint with availability checking and scoring
- Assignment endpoint for resource allocation with date scheduling
- Schedule endpoint combining assignments and availability for week planning
- Frontend: Resource assignment dialog with scored candidate list in Assignments page
- Assign/reassign button in assignments table for quick resource assignment
- Navigation updated: OrderConceptsPage and AssignmentsPage under "Planering" menu
- **UX Improvements:**
  - Capacity overview heatmap in WeekPlanner showing resource utilization (green/yellow/red)
  - Access information (portkod/nyckelnummer) displayed prominently on all job cards
  - Pulsing real-time status indicators for active field workers (on_way/on_site)
  - 4-step workflow indicator in mobile app (Åka dit→Starta→Utför→Slutför)
  - Enhanced access code display with dedicated cards in SimpleFieldApp

### Sprint 4 (In Progress)
- **Route Optimization Enhancements:**
  - VRP route visualization with OptimizedRouteMap showing numbered stops and polylines
  - "Apply optimization" endpoint to persist optimized order sequences to database
  - AI route recommendations with weather-based suggestions via Open-Meteo API
  - Weather impact cards showing temperature, precipitation, wind speed, and capacity adjustments

- **Customer Notifications (E-post):**
  - Email notification system via Resend integration (`server/customer-notifications.ts`)
  - Automatic "technician on the way" notifications with estimated arrival time
  - Notification button in mobile field app (SimpleFieldApp) for one-tap customer alerts
  - API endpoints: `/api/notifications/technician-on-way/:workOrderId`, `/api/notifications/job-completed/:workOrderId`
  - Note: SMS via Twilio available but not configured - can be added when needed

- **Customer Portal:**
  - Existing CustomerPortalPage (`/customer-portal`) allows staff to view customer orders
  - Authenticated API endpoint `/api/portal/customer/:customerId/orders` for secure order retrieval
  - Shows upcoming visits and historical order data per customer

- **Fortnox Integration (Previously Implemented):**
  - Full OAuth flow for Fortnox authentication
  - Entity mapping (customers, articles, cost centers, projects)
  - Invoice export pipeline from completed work orders
  - FortnoxSettingsPage (`/fortnox-settings`) for configuration