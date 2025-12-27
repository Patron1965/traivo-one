# Unicorn - AI-Driven Field Service Planning Platform

## Overview
Unicorn is an AI-driven planning platform designed for field service companies in the Nordic market, developed in collaboration with Kinab AB. Its primary purpose is to provide comprehensive optimization across various aspects of field service operations, including route optimization, resource planning, economic control, productivity improvements, and predictive analytics. The project aims to first prove value with Kinab AB, focusing on waste management and refuse collection, and then scale into a commercial multi-tenant SaaS solution for all Nordic service companies.

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic
- **Theme:** Dark/light mode support
- **Font:** Inter for UI

## System Architecture
The Unicorn platform is built as a functional prototype using a modern web stack.

### UI/UX Decisions
The user interface emphasizes a clean, professional Nordic aesthetic with support for both dark and light themes, utilizing the Inter font for consistency. Key UI components include:
-   **TopNav:** Sticky horizontal top navigation (h-16) replacing the previous sidebar:
    - Logo and company name (Unicorn/Kinab AB)
    - Four dropdown categories: Grunddata, Planering, Analys, System
    - Global search bar with Cmd+K shortcut
    - Notifications, Help, AI Assistant, Theme toggle
    - User profile dropdown with settings and logout
-   **MobileNav:** Hamburger menu (Sheet) for mobile devices with grouped navigation
-   **FloatingActionButton (FAB):** Quick actions button (bottom-right) for creating orders, customers, etc.
-   **QuickStats:** Dashboard cards showing key metrics (customers, orders, clusters, revenue)
-   **WeekPlanner:** A drag-and-drop interface for weekly scheduling.
-   **RouteMap:** Visualization of optimized routes.
-   **ObjectCard:** Displays object details, including setup time information.
-   **Dashboard:** Provides analytics and KPIs based on real setup logs.
-   **MobileFieldApp:** A dedicated interface for field technicians.
-   **Button size="mobile":** A dedicated button size variant (min-h-14, text-lg) for mobile field apps with larger touch targets.
-   **SignatureCapture:** Canvas-based digital signature collection for customer sign-off on completed jobs.
-   **JobProtocolGenerator:** Automatic PDF report generation on job completion with job details, photos, signature, and time tracking.
-   **Native Mobile App (Expo/React Native):** Separate mobile app in `mobile/` folder for field workers:
    - Login with email + PIN
    - View assigned work orders for the day
    - Start/complete/cancel orders with status workflow
    - Add notes to orders
    - Navigate to addresses via native maps
    - Call customers directly

### Technical Implementations
-   **Frontend:** React, TypeScript, Vite.
-   **Backend:** Express.js.
-   **Database:** PostgreSQL with Drizzle ORM.
-   **Multi-tenancy:** Supported at the database level.
-   **MCP Server (Model Context Protocol):** External AI assistants can interact with Unicorn data:
    - SSE endpoint: `GET /mcp/sse` for real-time connection
    - Message endpoint: `POST /mcp/messages` with X-MCP-Session-Id header
    - Resources: work-orders, resources, clusters
    - Tools: get_work_orders, get_resources, get_clusters, schedule_work_order, get_daily_summary
    - Documentation: `docs/MCP_INTEGRATION.md`
-   **Modus 2.0 Import System:** Dedicated `/import` page for CSV imports of Objects, Tasks, and Events from Modus 2.0, including data transformation and validation (e.g., geocoding, parent linking).
-   **Lazy Object Loading:** Implemented across components using `useObjectsByIds` and `useObjectSearch` hooks to optimize performance by fetching only necessary data.
-   **Address Search/Autocomplete:** `AddressSearch` component using OpenStreetMap Nominatim API for Swedish address geocoding. Used in cluster creation form to auto-populate coordinates and postal codes.
-   **Real-time Notifications (WebSocket):** Push notifications to field workers when work orders change:
    - WebSocket server at `/ws/notifications` with token-based authentication
    - Token endpoint: `POST /api/notifications/token` (requires authentication, validates tenant)
    - 5 notification types: job_assigned, job_updated, job_cancelled, schedule_changed, priority_changed
    - Frontend hook: `useNotifications` handles token acquisition, connection, and reconnection
    - Field apps: SimpleFieldApp and MobileFieldApp show connection status badge and toast notifications
    - **Production TODO:** Implement user-to-resource mapping for fine-grained authorization (currently validates tenant only)
-   **Mobile API Endpoints:** Dedicated endpoints for mobile app:
    - `POST /api/mobile/login` - Login with email + PIN
    - `POST /api/mobile/logout` - Logout
    - `GET /api/mobile/me` - Get logged-in resource
    - `GET /api/mobile/my-orders` - Get assigned work orders (with ?date filter)
    - `GET /api/mobile/orders/:id` - Get order details
    - `PATCH /api/mobile/orders/:id/status` - Update status (scheduled → in_progress → completed)
    - `POST /api/mobile/orders/:id/notes` - Add note to order
    - **Production TODO:** Implement proper PIN hashing/verification (currently simplified for demo)

### Feature Specifications
-   **Clusters:** A core concept for geographic organization, managing entities like objects and orders, visualized via lists and interactive maps (react-leaflet).
-   **Order Management:** Comprehensive workflow with status tracking (created, pre-planned, resource-planned, locked, executed, invoiced), cost/value tracking, and simulation capabilities. Includes work order lines with hierarchical price resolution.
-   **Pricing System:** Three-tier hierarchy (general, customer, discount letter) for articles and services.
-   **Fleet & Resource Management:** Tracking of vehicles and equipment, resource allocation with competencies and "tidsverk" (article assignments), and resource availability scheduling.
-   **Subscription Management:** Handling recurring services with various periodicities and automatic order generation.
-   **Planning Parameters:** Configuration of SLA levels, time slots, and other production control settings.

### System Design Choices
-   **Hierarchical Object Structure:** `Område → Fastighet → Rum` (Area → Property → Room) to manage customer locations.
-   **External Service Integration:** Route optimization is offloaded to a separate, external Unicorn optimization service. Data preparation for this external service is handled internally. A separate DataClean service is used for data validation and geocoding.

## AI Strategy (Core Principle)
AI-stöd ska genomsyra hela Unicorn-plattformen. Varje funktion bör övervägas för AI-förbättring:

### Implementerade AI-funktioner
- **Integrerade AI-kort (AICard):** Kontextmedvetna AI-paneler integrerade direkt i varje sida:
  - Veckoplaneraren: Full AISuggestionsPanel med auto-schemaläggning, arbetsbelastningsanalys, ruttoptimering
  - Kluster, Orderstock, Dashboard, Objekt, Resurser, Rutter: Kompakta AI-kort med modulspecifika insikter
  - Övriga moduler: GlobalAIButton med funktionell AI-chatt (/api/ai/chat endpoint)
  - Hybrid-approach: Rika AI-upplevelser där kontext finns, funktionell chatt överallt annars
- **AI Planning Assistant:** Analyserar veckoplanering och ger förslag för att balansera arbetsbelastning, optimera körtid och prioritera akuta ordrar.
- **AI Auto-Scheduling med väderoptimering:** Automatisk schemaläggning som:
  - Hämtar 7-dagars väderprognos från Open-Meteo API för Umeå
  - Justerar kapacitet baserat på väderförhållanden (multiplikator 0.4-1.0)
  - Prioriterar dagar med bra väder för utomhusarbeten (+15 poäng för bra, -10 för svårt)
  - Grupperar ordrar efter kluster för effektivare körning
  - Inkluderar väderinformation i AI-analysen för kontextmedvetna förslag

### Planerade AI-funktioner
- **Automatisk klusterbildning:** AI analyserar objekts geografi och servicemönster för att föreslå optimala kluster
- **Prediktiv schemaläggning:** Lär sig från historik för att föreslå bästa servicetider
- **Anomali-detektion:** Identifierar avvikande ställtider och kostnadsmönster
- **Smart ruttoptimering:** Per-kluster daglig optimering med hänsyn till tidsfönster och trafikprognoser
- **Naturligt språk-gränssnitt:** Fråga systemet på naturligt språk ("Vilka kluster har överbelastade veckor?")

### AI-teknologi
- **Provider:** OpenAI via Replit AI Integrations (ingen egen API-nyckel krävs)
- **Modeller:** gpt-4o-mini för snabba analyser, gpt-4o för komplexa beslut
- **Mönster:** Kontext-driven prompting med strukturerad JSON-output

## External Dependencies
-   **PostgreSQL:** Primary database for persistent storage.
-   **Drizzle ORM:** Used for database interactions.
-   **OpenAI API:** AI-drivna planeringsförslag via Replit AI Integrations.
-   **OpenRouteService:** Utilized for route visualization.
-   **OpenStreetMap Nominatim:** Free geocoding API for address search/autocomplete (Swedish addresses).
-   **External Unicorn Optimization Service:** A separate, dedicated service for performing route optimization calculations.
-   **DataClean Service:** An external service for data validation and geocoding.
-   **Modus 2.0:** Source of CSV data for initial import and ongoing data synchronization.
-   **react-leaflet:** Used for interactive map visualizations.
-   **shadcn/ui:** UI component library.

## Pending Integrations
-   **Twilio SMS:** User dismissed the Twilio connector integration. If SMS notifications are needed in the future, ask user to either:
    1. Set up the Twilio connector integration, or
    2. Provide TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER as secrets manually