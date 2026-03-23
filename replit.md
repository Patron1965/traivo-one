# Traivo - AI-Driven Field Service Planning Platform

## Overview
Traivo is an AI-driven platform designed to optimize field service operations, initially for Nordic waste management companies. It aims to revolutionize field service by transitioning from manual management to AI-driven optimization, offering real-time decision support for route planning, resource allocation, economic control, productivity, and predictive analytics. The project's vision is to become the leading platform for Nordic field service, evolving into a commercial SaaS solution with comprehensive multi-tenant capabilities.

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
The user interface includes a sticky TopNav, global search, mobile-friendly hamburger menu, Floating Action Button, QuickStats, WeekPlanner with drag-and-drop, RouteMap visualization, ObjectCards, and a comprehensive Dashboard. Mobile interfaces feature a MobileFieldApp with large buttons, SignatureCapture, MaterialLog, and a JobProtocolGenerator. The UI supports contextual help, progressive loading, white-label multi-tenancy, an AI Command Center, interactive Tour Guide, and role-based navigation filtering.

### Technical Implementations
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Express.js with modular route architecture.
- **Database:** PostgreSQL with Drizzle ORM.
- **Multi-tenancy:** Full tenant isolation at database and API level with middleware and role-based access control.
- **AI Integration:** AI-first approach with OpenAI for AI Cards, AI Planning Assistant, AI Auto-Scheduling, and a Conversational AI Planner. Includes budget enforcement and monitoring.
- **Modus 2.0 Import System:** Step-by-step CSV data migration with validation, real-time progress, Data Health Scorecard, Preview & Rename phase (rename objects/customers/metadata/resources before import), selective modular import (skip/import individual steps with summary view and localStorage persistence), and Import Health Overview with data quality warnings (4-stat grid: customers/objects/work orders/invoice lines), 5 issue types with severity levels (no-coords, no-address, no-customer, unassigned resources, empty-metadata), "Granska" links with server-side issue filtering on ObjectsPage and WeekPlannerPage, tenant-scoped accept/dismiss via localStorage, and filter banners with "Rensa filter" buttons.
- **Geocoding:** Geoapify Geocoding API with Nominatim fallback.
- **Performance:** Database indexes, server-side pagination, optimized loading, lazy object loading, and address search/autocomplete.
- **Real-time Capabilities:** Real-time Notifications (WebSocket) and Real-time GPS Position Tracking.
- **Offline Architecture:** Complete offline-first architecture for mobile field workers using IndexedDB.
- **Automatic Anomaly Monitoring:** Background job for detecting operational anomalies and broadcasting alerts.
- **Mobile API Endpoints:** Dedicated REST API for mobile features including login, order/resource retrieval, status updates, notes, deviations, material logging, signature, inspection, GPS tracking, weather, AI chat, transcription, and image analysis, with offline sync capabilities.
- **Advanced Task & Object Features:** Hierarchical object structure, article hook system, EAV metadata, multi-parent relations, comprehensive work order management, and per-object article management with resolved pricing.
- **Customer Portal 2.0:** Enhanced self-service portal with token-based authentication, featuring upcoming visits, order history, real-time chat, self-booking, and dynamic widgets.
- **Scheduling & Reporting:** Flexible scheduling with frequency metadata, dynamic structural articles, protocol/deviation report generation, Weekly Goal Progress Bars, Haversine-based Travel Time Calculation, and Auto-Fill Week functionality with cluster-aware resource assignment.
- **QR-code based Issue Reporting:** Public mobile web interface for anonymous issue reporting.
- **Environmental Statistics & Certificates:** Tracking mileage, fuel, CO2, and generation of annual environmental certificates.
- **Industry Packages System:** Predefined templates for different industries with configurable articles and metadata.
- **SMS Infrastructure:** Unified multi-channel notification service supporting email and SMS.
- **Route Feedback System:** Driver daily route ratings, reason categories, free text, and reporting UI with KPI cards and charts, with an AI field assistant for querying feedback.
- **Planner Map:** Real-time driver/job map with real road geometry, per-route filtering, status filter chips, enhanced job popups, colored driver avatars, and route information.
- **Historical Map View:** Playback of daily GPS movement patterns per resource with timeline slider and KPI overlay.
- **Reporting & KPI Dashboard:** Enhanced `/reporting` page with tabs for overview, productivity, completion, deviations, resources, areas, and customers, featuring Recharts diagrams.
- **Execution Codes & Resource Profiles:** System for mapping resource capabilities to task requirements, and profile templates defining execution codes, equipment, cost centers, project codes, and service areas for auto-planning.
- **Work Sessions & Time Tracking (Snöret):** Complete work session management system with check-in/check-out, time entries, weekly time summaries, labor rule violation detection, and payroll CSV export.
- **Annual Planning (Årsplanering):** Annual goal tracking per customer/object with AI-driven distribution proposing optimal monthly work order distribution.
- **Equipment Sharing & Shift Collision Control:** Tracking vehicle/equipment bookings, collision detection, and availability timeline.
- **Article Dependencies & Pickup Tasks:** Automatic pickup task generation for dependent articles.
- **Time Restrictions:** Object-level time restrictions impacting auto-planning and WeekPlanner.
- **Structural Tasks:** Composite tasks composed of multiple sub-steps.
- **Auto Metadata Writeback & Change History:** Automatic metadata updates and UI for viewing change history.
- **Orderkoncept System:** Scenario-based order automation (Avrop, Schema, Abonnemang) with a 9-step wizard for building delivery schedules and subscription calculations.
- **Smart AI Kontrollmallar & Field Validation:** AI-driven control templates (formerly "Checklista-mallar", renamed to "Kontrollmallar") for field workers suggesting steps based on order type and history, with mandatory field validation before completion.
- **Field Worker Task Dependency View & Photo Upload:** Mobile app displays task dependencies and supports two-step presigned URL photo uploads.
- **Invoice Preview/Generation & Fortnox Export:** Full invoicing page with preview, filtering, batch selection, Fortnox export, and export history.
- **Team Management & User Administration:** User management with admin CRUD, team system, bulk actions, and invitation system.
- **Access Control & Invitations:** Frontend access gate and admin invitation system for pre-approving users with role assignment.
- **Företagsinställningar (Tenant Configuration):** Dedicated `/tenant-config` page for company setup, articles, execution codes, price lists, resources, permissions, and branded demo configuration.
- **Branded Demo Experience:** Quick branding editor in tenant settings with live preview and auto-scrape feature.
- **Fleet Management:** Comprehensive fleet management page with vehicle dashboard, maintenance planning, and fuel tracking.
- **Tenant Onboarding Wizard:** Admin wizard for creating new company accounts with industry package selection.
- **Multi-Strategy Auto-Clustering:** Enhanced `/auto-cluster` page with 5 strategies for automatic cluster generation.
- **Interim Objects & Object Verification:** `isInterimObject` flag for public issue reports with admin UI for verification.
- **IoT API & Automatic Order Generation:** Management of IoT devices, API keys, and signals, with auto-generation of work orders based on sensor signals.
- **Predictive Maintenance:** AI-driven predictive maintenance using IoT signal history to forecast next service date with confidence scoring.
- **ROI-rapport:** Generalized ROI report per customer calculated from real usage data.
- **SlotPreference System:** Extended object time restrictions with `preference` and `reason` fields, UI for visualization, and aggregated preferences for order placement.
- **Job Creation Price List Override:** Optional price list selector in JobModal allowing manual override of automatic price resolution hierarchy.
- **Planned Notes (Meddelande till utförare):** Planner can write messages to field workers, displayed prominently in the SimpleFieldApp.
- **Tenant Feature Flags:** Module-based feature packaging system with 4 tiers, allowing per-tenant module enablement.
- **WeekPlanner Drag-and-Drop Improvements:** Inline conflict indicators, multi-select bulk-move, and AI "Föreslå optimal tid" per order with scoring algorithm.
- **Smart Navigation i Fältappen:** Travel distance/time display per job card, "Nästa stopp" navigation card with deep links, and 10-minute timer warning toast.
- **Smart AI Resource Allocation:** AI-förslag button in JobModal suggests top 3 best-fit resources, competency warning banner, and "Auto-fördela idag" button for unplanned orders.
- **Constraint Engine & Decision Trace:** Deterministic constraint validation layer for AI auto-schedule against hard and soft constraints, risk score calculation, and detailed `decisionTrace` logging for audit.

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
- **Fortnox API:** Integration with the Fortnox accounting system for entity import and export.
- **Resend:** Email notification service.
- **Twilio API:** SMS notification service.
- **jsPDF:** PDF generation library.
- **Replit Object Storage:** Photo uploads and file storage.