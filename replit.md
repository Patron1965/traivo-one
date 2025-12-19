# Nordic Routing - AI-Driven Field Service Planning Platform

## Overview
Nordic Routing is an AI-driven planning platform designed to optimize "ställtid" (setup time) for field service companies in the Nordic market. The platform targets the 15-25% of workday lost to setup inefficiencies (gate access, parking, finding keys).

**Design Partner:** Kinab AB (avfallshantering/sophämtning)
**Goal:** Prove value through measurable savings before scaling to commercial multi-tenant SaaS

## Kinab Business Domain
Kinab arbetar med avfallshantering och sophämtning. Viktiga termer:
- **Objekt:** Hierarkiskt uppbyggt (Område → Fastighet/Adress → Rum/Delobjekt)
- **Objekttyper:** omrade, fastighet, serviceboende, rum, soprum, kok, uj_hushallsavfall, matafall, atervinning
- **Tillgångstyper:** öppet (open), kod (code), nyckel/bricka (key), personligt möte (meeting)
- **Kärltyper:** K1 (standard), K2 (pant), K3 (matavfall), K4 (övrigt)
- **Kunder:** Bostadsbolag (Telgebostäder), Serviceboenden (äldreboenden)

## Current State
- **Phase:** Functional Prototype with Real Data
- **Status:** Database connected, API working, frontend showing real Kinab data
- **Stack:** React + TypeScript + Vite + Express + PostgreSQL + Drizzle ORM

## Project Structure
```
client/src/
├── components/
│   ├── layout/
│   │   └── AppSidebar.tsx       # Main navigation sidebar
│   ├── WeekPlanner.tsx          # Drag-drop weekly scheduling view
│   ├── ObjectCard.tsx           # Object display with setup time info
│   ├── RouteMap.tsx             # Route optimization view
│   ├── Dashboard.tsx            # Analytics and KPIs (uses real setup logs)
│   ├── MobileFieldApp.tsx       # Field technician mobile interface
│   ├── JobModal.tsx             # Create/edit job modal
│   └── ThemeToggle.tsx          # Light/dark theme toggle
├── pages/
│   ├── WeekPlannerPage.tsx      # Main planning view
│   ├── OptimizationPrepPage.tsx # Weekly optimization preparation
│   ├── RoutesPage.tsx           # Route visualization
│   ├── ObjectsPage.tsx          # Hierarchical object management
│   ├── ResourcesPage.tsx        # Resource management
│   ├── DashboardPage.tsx        # Analytics dashboard
│   └── SettingsPage.tsx         # User/company settings
└── App.tsx                       # Main app with sidebar layout

server/
├── index.ts                      # Express server entry
├── routes.ts                     # Full CRUD API routes
├── storage.ts                    # Database storage interface
├── db.ts                         # PostgreSQL connection
└── seed.ts                       # Kinab test data

shared/
└── schema.ts                     # Drizzle schema with hierarchical objects
```

## Database Schema
- **tenants:** Multi-tenant support
- **customers:** Telgebostäder, Serviceboenden
- **objects:** Hierarchical (parentId), with accessType, accessCode, containerCounts
- **resources:** Technicians with competencies
- **work_orders:** Jobs with scheduling
- **setup_time_logs:** Ställtidsloggning per jobb

## Key Features
1. **Veckoplanering:** Drag-drop scheduling with priority colors
2. **Inför Optimering:** Weekly optimization preparation with data validation (prepared for external Nordic Routing API integration)
3. **Ruttplanering:** Route visualization with OpenRouteService
4. **Objekt:** Hierarchical tree view (Område → Fastighet → Rum)
5. **Resurser:** Technician management with competencies
6. **Dashboard:** Real analytics from setup_time_logs
7. **Mobile Field App:** Access info, job completion, ställtidsrapportering

## Architecture Decision: External Optimization
- Route optimization is handled by external Nordic Routing optimization service (separate Replit)
- "Inför Optimering" page prepares and validates data before sending to external API
- DataClean service (separate Replit) handles data validation and geocoding
- This app focuses on visualization, scheduling, and field service workflow

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic
- **Theme:** Dark/light mode support
- **Font:** Inter for UI

## Recent Changes
- 2024-12-19: Added "Inför Optimering" page for weekly optimization preparation
- 2024-12-19: Removed local optimization logic from RouteMap (external API integration)
- 2024-12-19: Landing page updated to "Optimera din Fältservice"
- 2024-12-17: Updated to Kinab's actual business domain (avfallshantering)
- 2024-12-17: Implemented hierarchical object structure (Område → Fastighet → Rum)
- 2024-12-17: Added Telgebostäder and Serviceboenden as customers
- 2024-12-17: Setup time logging from MobileFieldApp to database
- 2024-12-17: Dashboard uses real setup_time_logs data

## Next Steps
1. Integrate with external Nordic Routing optimization API
2. Integrate with DataClean service for data validation
3. Review and adjust data model based on Kinab feedback
4. Import real Kinab object data
