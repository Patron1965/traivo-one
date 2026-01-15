# Unicorn - AI-Driven Field Service Planning Platform

## Overview
Unicorn is an AI-driven platform designed to optimize field service operations for Nordic companies, starting with waste management. It transitions from manual management to AI-driven optimization, offering real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's ambition is to become the standard platform for Nordic field service, initially demonstrating value with Kinab AB and then scaling into a commercial multi-tenant SaaS solution.

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
- **Multi-tenancy:** Full tenant isolation at database and API level with middleware, dynamic tenant selection from user sessions, tenant ownership verification, and role-based access control.
- **MCP Server (Model Context Protocol):** Enables external AI assistants to interact with Unicorn data via SSE.
- **Modus 2.0 Import System:** Dedicated `/import` page for CSV imports with data transformation and validation.
- **Lazy Object Loading:** Performance optimization using `useObjectsByIds` and `useObjectSearch` hooks.
- **Address Search/Autocomplete:** Uses OpenStreetMap Nominatim API for Swedish address geocoding.
- **Real-time Notifications:** Token-based authenticated WebSocket push notifications for field workers and system-wide broadcasts.
- **Real-time GPS Position Tracking:** Tracks field resource locations with breadcrumb trails, storing history and providing real-time updates.
- **Automatic Anomaly Monitoring:** Background job detects operational anomalies and broadcasts alerts.
- **Mobile API Endpoints:** Dedicated endpoints for mobile login, resource/order retrieval, status updates, and note-taking.
- **Advanced Task & Object Features:** Includes tables for object images, object contacts, task desired timewindows, task dependencies, task information, and structural articles. Work orders support an 8-step execution status workflow, creation method tracking, what3words locations, and GPS coordinates.

### Feature Specifications
- **Clusters:** Core concept representing customer-based hierarchy with data inheritance, visualizing with lists and interactive maps.
- **Order Management:** Comprehensive workflow with status tracking, cost/value tracking, and simulation.
- **Pricing System:** Three-tier hierarchy (general, customer, discount letter) for articles and services.
- **Fleet & Resource Management:** Tracking of vehicles, equipment, resource allocation with competencies, and availability scheduling.
- **Subscription Management:** Handles recurring services and automatic order generation.
- **Planning Parameters:** Configuration of SLA levels and time slots.
- **Hierarchical Object Structure:** Customer-centric tree structure (`Koncern → BRF → Fastighet → Rum → Kärl`) with top-down data inheritance and configurable propagation rules (Fixed, Falling, Dynamic).
- **Article Hook System:** Enables automatic article suggestions for objects based on hierarchy level and conditions.
- **Fortnox Integration:** Full integration with the Fortnox accounting system, including OAuth, entity mapping, and an invoice export pipeline with multi-payer support.
- **EAV Metadata System:** Flexible Entity-Attribute-Value system for object metadata, supporting various datatypes, inheritance, cross-fertilization, and geographic position priority. Includes admin interfaces for catalog management and tenant isolation.
- **Customer Portal:** Allows staff to view customer orders and provides a customer self-service portal with token-based magic link authentication for viewing upcoming visits, history, and submitting booking requests.
- **Advanced Scheduling & Structural Articles (Modus 2.0):** Flexible scheduling with frequency metadata (weekdays, seasonal filters) and dynamic structural articles supporting seasonal adjustments and metadata-driven multiplication. Includes protocol and deviation report generation with PDF and email capabilities.
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting via QR codes, allowing GPS position, photos, and conversion to work orders.
- **Environmental Statistics:** Tracking of mileage, fuel, chemicals, CO2 calculations, and aggregated statistics.
- **Metadata-triggers:** System for listing objects with deviations, tracking issue history, and categorizing problems.

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
- **jsPDF:** PDF generation library.