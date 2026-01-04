# Unicorn - AI-Driven Field Service Planning Platform

## Overview
Unicorn is an AI-driven planning platform designed to optimize field service operations for Nordic companies, starting with waste management. The platform aims to transition from manual management to AI-driven optimization, offering real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's ambition is to become the standard platform for Nordic field service, initially proving value with Kinab AB and then scaling into a commercial multi-tenant SaaS solution.

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic
- **Theme:** Dark/light mode support
- **Font:** Inter for UI

## System Architecture
The Unicorn platform is a functional prototype built with a modern web stack, emphasizing a clean Nordic aesthetic and deep AI integration.

### UI/UX Decisions
The user interface includes a sticky TopNav, global search, user utilities, and a mobile-friendly hamburger menu. Key components are a Floating Action Button, QuickStats dashboard cards, a drag-and-drop WeekPlanner, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Dedicated mobile interfaces for field technicians feature a MobileFieldApp with large buttons, SignatureCapture, MaterialLog with autocomplete for Nordic waste items, and a JobProtocolGenerator for automatic PDF reporting. The UI supports contextual help with `HelpTooltip` and `PageHelp` components, and implements progressive loading using skeleton placeholders.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Supported at the database level.
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
- **Clusters:** Core concept for geographic organization, visualized with lists and interactive maps.
- **Order Management:** Comprehensive workflow with status tracking, cost/value tracking, and simulation.
- **Pricing System:** Three-tier hierarchy (general, customer, discount letter) for articles and services.
- **Fleet & Resource Management:** Tracking of vehicles, equipment, resource allocation with competencies, and availability scheduling.
- **Subscription Management:** Handles recurring services and automatic order generation.
- **Planning Parameters:** Configuration of SLA levels and time slots.
- **Hierarchical Object Structure:** `Område → Fastighet → Rum` (Area → Property → Room) for managing customer locations, with inherited information and metadata propagation rules (fixed, falling, dynamic).
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