# Unicorn - AI-Driven Field Service Planning Platform

## Overview
Unicorn is an AI-driven planning platform for field service companies in the Nordic market, developed in collaboration with Kinab AB. Its purpose is to optimize route planning, resource allocation, economic control, productivity, and predictive analytics. The project aims to first prove value with Kinab AB in waste management and refuse collection, then scale into a commercial multi-tenant SaaS solution for all Nordic service companies. The ambition is to transition from manual micromanagement to AI-driven optimization, providing real-time decision support and becoming the standard platform for Nordic field service.

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic
- **Theme:** Dark/light mode support
- **Font:** Inter for UI

## System Architecture
The Unicorn platform is a functional prototype built with a modern web stack, emphasizing a clean Nordic aesthetic and AI integration throughout.

### UI/UX Decisions
The user interface features a sticky TopNav with dropdown categories (Grunddata, Planering, Analys, System), a global search, and user utilities. Mobile navigation uses a hamburger menu (Sheet). Key components include a Floating Action Button for quick actions, QuickStats dashboard cards, a drag-and-drop WeekPlanner, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Dedicated mobile interfaces for field technicians include a MobileFieldApp with a large button size variant, SignatureCapture, MaterialLog with autocomplete for Nordic waste management items, and a JobProtocolGenerator for automatic PDF reporting.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Supported at the database level.
- **MCP Server (Model Context Protocol):** Enables external AI assistants to interact with Unicorn data via SSE and message endpoints for resources and work order management.
- **Modus 2.0 Import System:** Dedicated `/import` page for CSV imports with data transformation and validation.
- **Lazy Object Loading:** Performance optimization using `useObjectsByIds` and `useObjectSearch` hooks.
- **Address Search/Autocomplete:** Uses OpenStreetMap Nominatim API for Swedish address geocoding.
- **Real-time Notifications (WebSocket):** Token-based authenticated push notifications for field workers (job status, schedule, priority changes, anomaly alerts) and system-wide broadcasts.
- **Real-time GPS Position Tracking:** Tracks field resource locations with breadcrumb trails, storing history in `resourcePositions` table, with real-time updates via WebSocket and HTTP fallback.
- **Automatic Anomaly Monitoring:** Background job detects operational anomalies (stale positions, delayed orders, setup time anomalies) and broadcasts high/critical alerts.
- **Mobile API Endpoints:** Dedicated endpoints for mobile login, resource/order retrieval, status updates, and note-taking.

### Feature Specifications
- **Clusters:** Core concept for geographic organization, visualized with lists and interactive maps.
- **Order Management:** Comprehensive workflow with status tracking, cost/value tracking, and simulation.
- **Pricing System:** Three-tier hierarchy (general, customer, discount letter) for articles and services.
- **Fleet & Resource Management:** Tracking of vehicles, equipment, resource allocation with competencies, and availability scheduling.
- **Subscription Management:** Handles recurring services and automatic order generation.
- **Planning Parameters:** Configuration of SLA levels and time slots.
- **Hierarchical Object Structure:** `Område → Fastighet → Rum` (Area → Property → Room) for managing customer locations, with inherited information.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Unicorn optimization service, with internal data preparation.
- **Data Validation:** DataClean service handles external data validation and geocoding.

### AI Strategy
AI is deeply integrated throughout the platform.
- **Implemented AI Features:**
    - **Integrated AI Cards (AICard):** Context-aware AI panels on every page, offering detailed suggestions on the WeekPlanner (auto-scheduling, workload analysis, route optimization) and compact insights on other modules. A global AI chat is available elsewhere.
    - **AI Planning Assistant:** Analyzes weekly planning to balance workload, optimize drive time, and prioritize urgent orders.
    - **AI Auto-Scheduling with Weather Optimization:** Uses 7-day weather forecasts from Open-Meteo API to adjust capacity, prioritize outdoor work, and group orders by cluster.
- **AI Technology:** Utilizes OpenAI via Replit AI Integrations (gpt-4o-mini for quick analyses, gpt-4o for complex decisions) with context-driven prompting and structured JSON output.

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