# Traivo - AI-Driven Field Service Planning Platform

## Overview
Traivo is an AI-driven platform designed to optimize field service operations for Nordic companies, starting with waste management. It aims to transition from manual management to AI-driven optimization, providing real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's ambition is to become the standard platform for Nordic field service, scaling into a commercial SaaS solution with full multi-tenant support.

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
The user interface includes a sticky TopNav, global search, user utilities, a mobile-friendly hamburger menu, Floating Action Button, QuickStats, a drag-and-drop WeekPlanner, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces for field technicians feature a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, and role-based navigation filtering.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js with modular route architecture and centralized error handling.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Full tenant isolation at database and API level with middleware and role-based access control.
- **AI Integration:** AI-first approach with OpenAI for AI Cards, AI Planning Assistant, AI Auto-Scheduling, and a Conversational AI Planner.
- **MCP Server:** Enables external AI assistants to interact with Traivo data via SSE.
- **Modus 2.0 Import System:** Dedicated import page for step-by-step data migration via CSV with validation, real-time progress, and Data Health Scorecard.
- **Data Health Scorecard:** Visual quality report at import validation showing overall data health score with category breakdowns (addresses, required fields, access info, duplicates), color-coded thresholds (green >90%, yellow 70-90%, red <70%), expandable detail views per category, problem row export to CSV, and "Import ändå" / "Åtgärda först" decision flow.
- **Geoapify Geocoding Integration:** Address resolution via Geoapify Geocoding API with Nominatim fallback for precise distance calculations.
- **Performance:** Database indexes, server-side pagination, optimized loading, lazy object loading, and address search/autocomplete.
- **Real-time Capabilities:** Real-time Notifications (WebSocket) and Real-time GPS Position Tracking.
- **Offline Architecture:** Complete offline-first architecture for mobile field workers using IndexedDB.
- **Automatic Anomaly Monitoring:** Background job for detecting operational anomalies and broadcasting alerts.
- **Mobile API Endpoints:** Dedicated REST API for mobile features including login, order/resource retrieval, status updates, notes, deviations, material logging, signature, inspection, GPS tracking, weather, AI chat, transcription, and image analysis, with offline sync capabilities.
- **Checklist Templates:** Article-type-based inspection checklist templates with admin CRUD.
- **Driver Push Notifications:** Persistent notification storage with REST polling and WebSocket integration.
- **Advanced Task & Object Features:** Hierarchical object structure, article hook system, EAV metadata, multi-parent relations, comprehensive work order management, and per-object article management with resolved pricing.
- **Customer Portal 2.0:** Enhanced self-service portal with token-based authentication, featuring upcoming visits, order history, real-time chat, self-booking with configurable options, and dynamic widget.
- **Scheduling & Reporting:** Flexible scheduling with frequency metadata, dynamic structural articles, protocol/deviation report generation, Weekly Goal Progress Bars, Haversine-based Travel Time Calculation, and Auto-Fill Week functionality with cluster-aware resource assignment.
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting.
- **Environmental Statistics & Certificates:** Tracking mileage, fuel, CO2, and generation of annual environmental certificates.
- **Metadata-triggers:** System for listing objects with deviations and tracking issue history.
- **Industry Packages System:** Predefined templates for different industries with configurable articles and metadata.
- **SMS Infrastructure:** Unified multi-channel notification service supporting email and SMS.
- **Route Feedback System:** Driver daily route ratings, reason categories, free text, and reporting UI with KPI cards and charts. AI field assistant tool for querying feedback data.
- **Planner Map (`/planner/map`):** Real-time driver/job map with real road geometry via Geoapify, per-route filtering, status filter chips, enhanced job popups, colored driver avatars, and route information.
- **Historical Map View:** Playback of daily GPS movement patterns per resource with timeline slider and KPI overlay.
- **API Cost Monitoring Dashboard:** Admin-only dashboard for real-time monitoring of external API costs.
- **Reporting & KPI Dashboard:** Enhanced `/reporting` page with tabs for overview, productivity, completion, deviations, resources, areas, and customers, featuring Recharts diagrams.
- **Execution Codes:** Many-to-many system mapping resource capabilities to task requirements.
- **Resource Profiles (Utföranderoller):** Profile templates defining execution codes, equipment types, cost center, project code, and service areas, used in auto-planning capability matching. Admin UI and WeekPlanner integration.
- **Work Sessions & Time Tracking (Snöret):** Complete work session management system with check-in/check-out, time entries by type, weekly time summaries, labor rule violation detection, and payroll CSV export.
- **Equipment Sharing & Shift Collision Control:** Tracking vehicle/equipment bookings per day with service area zones, collision detection, auto-release, and availability timeline.
- **Article Dependencies & Pickup Tasks:** Automatic pickup task generation for dependent articles.
- **Time Restrictions:** Object-level time restrictions impacting auto-planning and WeekPlanner.
- **Structural Tasks:** Composite tasks composed of multiple sub-steps.
- **Auto Metadata Writeback & Change History:** Automatic metadata updates and UI for viewing change history.
- **Orderkoncept System:** Scenario-based order automation (Avrop, Schema, Abonnemang) with a 9-step wizard for building delivery schedules and subscription calculations, including customer identification modes and validation.
- **Field Worker Task Dependency View:** Mobile app displays task dependencies.
- **Field Worker Photo Upload:** Two-step presigned URL flow for photo capture.
- **Inspection & Metadata System:** Structured inspection checklist integrated into the mobile app.
- **Invoice Preview/Generation & Fortnox Export:** Full invoicing page with preview, filtering, batch selection, Fortnox export, and export history.
- **Team Management & User Administration:** User management page with admin CRUD for users, team system, and bulk actions.
- **Företagsinställningar (Tenant Configuration):** Dedicated `/tenant-config` page for company setup, articles, execution codes, price lists, resources, permissions, and branded demo configuration.
- **Branded Demo Experience:** Quick branding editor in Företagsinställningar → Varumärke tab. Configure company name, logo URL, tagline, and color palette for sales demos. Live preview of splash screen and TopNav. WelcomeSplash and TopNav automatically reflect tenant branding when configured, falling back to Traivo defaults. **Auto-scrape feature:** enter a prospect's website URL and the system automatically extracts logos, brand colors, and company name from the HTML (og:image, theme-color, favicon, logo images, inline CSS colors).
- **Fleet Management:** Comprehensive fleet management page with vehicle dashboard, maintenance planning, and fuel tracking.
- **Tenant Onboarding Wizard:** Admin wizard for creating new company accounts with industry package selection.
- **Multi-Strategy Auto-Clustering:** Enhanced `/auto-cluster` page with 5 strategies for automatic cluster generation, including smart auto-assignment and manual cluster movement.
- **Interim Objects & Object Verification:** `isInterimObject` flag on objects table for public issue reports, with admin UI for verification/rejection.
- **IoT API & Automatic Order Generation:** Management of IoT devices, API keys, and signals. Auto-generates work orders based on sensor signals (e.g., `full`, `damaged`, `overflow`).
- **SlotPreference System:** Extended object time restrictions with `preference` and `reason` fields, UI for visualization, and aggregated preferences for order placement.

### System Design Choices
- **AI-first approach:** AI integration is a core principle, with every function considered for AI enhancement.
- **External Optimization:** Route optimization is offloaded to a separate Traivo optimization service.
- **Data Validation:** DataClean service handles external data validation and geocoding.
- **Mobile Field App API (Driver Core Integration):** Complete REST API for the Driver Core mobile field app.

## External Dependencies
- **PostgreSQL:** Primary database.
- **Drizzle ORM:** Database interactions.
- **OpenAI API:** AI planning suggestions, conversational AI.
- **Geoapify:** Route calculation (Routing API) and VRP optimization (Route Planner API).
- **OpenStreetMap Nominatim:** Geocoding for Swedish addresses.
- **External Traivo Optimization Service:** Dedicated route optimization.
- **DataClean Service:** External service for data validation and geocoding.
- **Modus 2.0:** Source of CSV data for imports.
- **react-leaflet:** Interactive map visualizations.
- **shadcn/ui:** UI component library.
- **Open-Meteo API:** Provides weather forecast data.
- **Fortnox API:** Integration with the Fortnox accounting system, including full entity import (customers, articles, cost centers, projects) from Fortnox with preview, selection/deselection, search/filter, duplicate detection, and batch import with automatic Fortnox mapping.
- **Resend:** Email notification service.
- **Twilio API:** SMS notification service.
- **jsPDF:** PDF generation library.
- **Replit Object Storage:** Photo uploads and file storage.