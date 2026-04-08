# Traivo - AI-Driven Field Service Planning Platform

## Overview
Traivo is an AI-driven platform designed to optimize field service operations for Nordic waste management companies. It aims to transform manual processes into AI-driven optimization, offering real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's vision is to become the leading commercial SaaS platform for Nordic field service with comprehensive multi-tenant capabilities. Key capabilities include AI-driven optimization, real-time decision support, and comprehensive multi-tenant functionalities.

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
The user interface features a sticky TopNav with smart navigation, global search, mobile-friendly hamburger menu, Floating Action Button, QuickStats, a drag-and-drop WeekPlanner, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces include a MobileFieldApp with essential field worker functionalities like SignatureCapture, MaterialLog, and JobProtocolGenerator. The UI supports contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, and role-based navigation filtering. Specific features include Pop-out Kartövervakning (map monitoring) and Pop-out Planering (planning) for dual-screen workflows.

### Design System & Consistency Standards
- **Page layout pattern:** All pages use `p-6 space-y-6` container with `text-2xl font-semibold` headings (no `container mx-auto` wrappers).
- **Dark mode:** Full dark mode support with explicit `dark:` Tailwind variants on all colored elements (badges, icons, stat values, indicators). Theme stored in `localStorage["theme"]`, toggled via `use-theme.tsx` hook.
- **Responsive tables:** Base `Table` component wraps with `overflow-auto`. Secondary columns use `hidden md:table-cell` / `hidden lg:table-cell` to hide on narrow screens.
- **Responsive filters:** Filter/action rows use `flex-wrap` to stack on narrow viewports.
- **Dialog overflow:** Base `DialogContent` includes `max-h-[90vh] overflow-y-auto` to prevent viewport overflow.
- **Color conventions:** Status/indicator colors always paired with `dark:` variants (e.g., `text-green-600 dark:text-green-400`, `bg-green-100 dark:bg-green-900/30`).
- **Empty states:** Reusable `EmptyState` component (`client/src/components/EmptyState.tsx`) with icon, title, description, and action button. Used across ResourcesPage, InvoicingPage, OrderStockPage, FleetManagementPage, MyTasksPage.
- **E2E tests:** Playwright test suite includes `tests/e2e/darkmode.spec.ts` (10 tests) covering dark mode rendering on all key pages plus mobile viewport.

### Technical Implementations
The platform uses React, TypeScript, and Vite for the frontend, and Express.js with a modular route architecture for the backend. PostgreSQL with Drizzle ORM is used for data persistence, supporting full tenant isolation and role-based access control. AI integration is central, leveraging OpenAI for various features like AI Cards, AI Planning Assistant, AI Auto-Scheduling, and Conversational AI Planner. Geocoding is handled by Geoapify with Nominatim fallback. Performance is optimized through database indexing, server-side pagination, and lazy loading. Real-time capabilities include WebSocket notifications and GPS tracking. An offline-first architecture is implemented for mobile field workers. The system includes an advanced Modus 2.0 Import System, automatic anomaly monitoring, and a Customer Portal 2.0 with enhanced self-service features. Routing is handled by Geoapify Routing API with Haversine fallback, and a dedicated OR-Tools Optimization Service (Python FastAPI microservice) solves CVRPTW with complex constraint integration (time windows, skills, capacity, dependencies). Other features include QR-code based issue reporting, environmental statistics, SMS infrastructure, route feedback, comprehensive reporting and KPI dashboards, work session and time tracking (Snöret), annual planning (Årsplanering), equipment sharing with collision control, smart AI control templates, invoice generation with Fortnox export, team and user management, tenant configuration, branded demo experience, fleet management, IoT API integration for automatic order generation, event-driven disruption service, intelligent break placement in VRP, feedback loop for estimated vs. actual service durations, customer ETA notifications, slot preference system, planned notes for field workers, and module-based tenant feature flags. Enhanced WeekPlanner drag-and-drop includes conflict indicators and AI suggestions. Smart navigation in the field app provides travel distance/time and "Nästa stopp" guidance. A deterministic constraint validation layer supports AI auto-schedule and risk scoring. Multi-customer billing and polyline/polygon support for spatial object selection are also implemented. Urgent job assignment includes nearest technician search and WebSocket notifications. Smart resource suggestions are based on cluster membership.

### Auto-Cluster System
Clusters are automatically generated based on customer ownership (customerId) when objects are created or imported. The `ensureClusterForCustomer()` function in `server/auto-cluster.ts` checks if a cluster already exists for the customer (via `rootCustomerId`), and creates one if not. The cluster name defaults to the customer name. Geo-center coordinates and `cachedObjectCount` are updated after import batches complete. All object creation paths are covered: POST /api/objects, CSV import, Modus import, mapped import, and portal interim objects. In-memory deduplication prevents concurrent cluster creation for the same customer within a single process. Cluster visualization: ObjectsPage shows cluster badge (teal Layers icon) on each object row with clickable link to cluster detail; cluster filter available in filter panel. ClustersPage emphasizes auto-creation with manual creation as secondary option.

### System Design Choices
An AI-first approach guides all functionalities. Route optimization is offloaded to a separate Traivo optimization service. DataClean service handles external data validation and geocoding. A complete REST API supports the Driver Core mobile field app with dual-format compatibility. Configurable status message templates, a resource availability service, and portal chat auto-responses enhance communication. Mobile API endpoints manage team functions, work sessions, statistics, routing, break configurations, ETA notifications, and user preferences. A server-driven mobile app configuration and version check system are in place. An AI Sales Intelligence Report aggregates customer data for analysis and recommendations.

## External Dependencies
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interactions.
- **OpenAI API:** AI planning, conversational AI.
- **Geoapify:** Route calculation (Routing API) and VRP optimization (Route Planner API).
- **OpenStreetMap Nominatim:** Geocoding fallback.
- **External Traivo Optimization Service:** Dedicated route optimization.
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