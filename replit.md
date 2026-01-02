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

## Recent Changes (2026-01-02)

### Database Schema Expansion - Fas 1 Foundation
Major schema additions to support Mats' cluster philosophy and MVP features:

#### New Tables Added:
1. **fortnox_config** - OAuth tokens and tenant-specific Fortnox configuration
2. **fortnox_mappings** - Entity synchronization between Unicorn and Fortnox (customers, articles, cost centers, projects)
3. **fortnox_invoice_exports** - Invoice export log with status tracking and error handling
4. **object_payers** - Multiple payers per object with split percentages and article type filtering
5. **metadata_definitions** - Propagation rules (fixed/falling/dynamic) for metadata fields
6. **object_metadata** - Metadata values on objects with inheritance logic and break flags

#### Schema Modifications:
- **objects**: Added `hierarchyLevel` field for explicit hierarchy type (koncern, brf, fastighet, rum, karl)
- **articles**: Added `hookLevel` and `hookConditions` for article fastening system (Kinab concept)
- **work_orders**: Added impossible order fields (`impossibleReason`, `impossibleReasonText`, `impossibleAt`, `impossibleBy`, `impossiblePhotoUrl`)
- **ORDER_STATUSES**: Added "omojlig" status for orders that cannot be completed

#### New TypeScript Constants:
- `OBJECT_HIERARCHY_LEVELS` - Hierarchy levels for cluster philosophy
- `ARTICLE_HOOK_LEVELS` - Hook levels for article fastening
- `METADATA_PROPAGATION_TYPES` - Metadata propagation types
- `IMPOSSIBLE_REASONS` - Standard reasons for impossible orders

#### PostgreSQL Functions:
- `get_effective_metadata(object_id, field_key)` - Returns inherited metadata value through hierarchy
- `get_all_effective_metadata(object_id)` - Returns all effective metadata for an object

### Kinab Cluster Philosophy (Mats Vision)
The system now supports hierarchical organization:
```
Koncern (Organization) → BRF (Housing association) → Fastighet (Property) → Rum (Room) → Kärl (Container)
```

Metadata propagation types:
- **Fixed** - Stays at the level where it's created
- **Falling** - Inherits automatically downward
- **Dynamic** - Changes over time and continues falling

### Article Hook System (Artikelfasthakning - Kinab-koncept)
The article hook system enables automatic article suggestions for objects based on their hierarchy level:

**Hook Levels:**
- `koncern` - Applies to organization-level objects
- `brf` - Applies to BRF (housing association) objects
- `fastighet` - Applies to property objects
- `rum` - Applies to room objects (soprum, kök, etc.)
- `karl` - Applies to all container types (T100 Kärltvätt)
- `karl_mat` - Only food waste containers (K100 Matavfallsdekal)
- `karl_rest` - Only residual waste containers
- `karl_plast` - Only plastic containers
- `kod` - Objects with access codes (KOD10)

**API Endpoint:**
- `GET /api/objects/:objectId/applicable-articles` - Returns articles matching the object's hook level

**Matching Logic:**
- Exact level matching (a fastighet hook only matches fastighet objects)
- hookConditions for additional filtering (container_type, etc.)
- Access code detection via object.accessCode field

### Fortnox Integration (Completed 2026-01-02)
Full integration infrastructure for Swedish accounting system:

**Configuration:**
- OAuth 2.0 flow preparation with client ID/secret storage
- Token management with automatic expiry tracking
- Tenant-scoped configuration in `fortnox_config` table

**Entity Mapping:**
- **Cost Centers** = Vehicles (registration number)
- **Projects** = Teams (team name)
- **Customers** = Unicorn customers mapped to Fortnox customer IDs
- **Articles** = Unicorn articles mapped to Fortnox article numbers

**Invoice Export Pipeline:**
- Export tracking with status (pending, exported, failed)
- Multi-payer support from `object_payers`
- Error logging and retry capability
- Full audit trail in `fortnox_invoice_exports` table

**API Endpoints:**
- `GET/POST/PATCH /api/fortnox/config` - Configuration management
- `GET/POST/DELETE /api/fortnox/mappings` - Entity mappings CRUD
- `GET/POST/PATCH /api/fortnox/exports` - Invoice export management
- `GET /api/fortnox/authorize` - Generate OAuth authorization URL
- `GET /api/fortnox/callback` - OAuth callback handler (token exchange)
- `GET /api/fortnox/status` - Check connection status
- `POST /api/fortnox/exports/:id/process` - Execute invoice export to Fortnox

**Fortnox Client (server/fortnox-client.ts):**
- OAuth 2.0 authorization and token exchange
- Automatic token refresh before expiry
- Rate limiting (5 concurrent requests via p-limit)
- Retry logic with exponential backoff (p-retry)
- Invoice creation with multi-payer split support

**Security:**
- All routes tenant-scoped with DEFAULT_TENANT_ID
- Zod validation on all mutation endpoints
- No cross-tenant data access possible

**UI:** FortnoxSettingsPage at `/fortnox` with tabs for OAuth config, mappings, and export history

**Rate Limits:** 25 requests/5 seconds per Fortnox API documentation

### Dashboard Anomaly Detection
Comprehensive anomaly monitoring with AI-powered explanations:
- **Setup Time Anomalies** - Detects unusually long or short setup times
- **Cost Anomalies** - Flags orders with unexpected cost variances
- **Impossible Orders** - Tracks orders marked as "omöjlig" with detailed reasons and photo evidence
- **AI Explanations** - OpenAI-generated insights for each anomaly type

### UX Simplification for Field Workers (2026-01-02)
Major usability improvements targeting non-technical field workers:

**New MyTasksPage (Home):**
- Simplified home page at `/` showing today's orders and key stats
- Large stat cards with progressive loading (skeleton placeholders per card)
- Friendly object names instead of raw IDs
- Quick action tiles linking to common workflows (Veckoplanering, Mobilapp, Karta, Support)
- Help section with FAQs for common questions

**Navigation Restructuring:**
- **TopNav:** Added "Start" home button, reorganized menu categories
- **MobileNav:** Matching structure with proper SPA navigation (wouter Link)
- **"Avancerat" menu:** Power-user features (MCP, Fortnox, Optimering, Fleet) grouped separately
- Route structure: `/` = MyTasksPage, `/planner` = WeekPlanner

**Contextual Help System:**
- **HelpTooltip component:** Inline explanations for form fields (info icon with popover)
- **PageHelp component:** Page-level guidance banners (collapsible)
- Applied to ArticlesPage (Fasthakning field) and SubscriptionsPage

**Progressive Loading Pattern:**
- Individual skeleton cards per data query instead of blocking entire page
- Orders, resources, objects load independently with visual feedback
- Prevents misleading zero values during data fetch

**Key Files:**
- `client/src/pages/MyTasksPage.tsx` - New home page
- `client/src/components/layout/TopNav.tsx` - Desktop navigation
- `client/src/components/layout/MobileNav.tsx` - Mobile navigation
- `client/src/components/ui/help-tooltip.tsx` - Help components