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
│   ├── RoutesPage.tsx           # Route optimization
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
2. **Objekt:** Hierarchical tree view (Område → Fastighet → Rum)
3. **Resurser:** Technician management with competencies
4. **Dashboard:** Real analytics from setup_time_logs
5. **Mobile Field App:** Access info, job completion, ställtidsrapportering
6. **Ruttplanering:** Route visualization (placeholder for Google Maps)

## User Preferences
- **Language:** Swedish (sv) for UI
- **Design:** Clean, professional Nordic aesthetic
- **Theme:** Dark/light mode support
- **Font:** Inter for UI

## Recent Changes
- 2024-12-17: Updated to Kinab's actual business domain (avfallshantering)
- 2024-12-17: Implemented hierarchical object structure (Område → Fastighet → Rum)
- 2024-12-17: Added Telgebostäder and Serviceboenden as customers
- 2024-12-17: Setup time logging from MobileFieldApp to database
- 2024-12-17: Dashboard uses real setup_time_logs data

## Next Steps
1. Review and adjust data model based on Kinab feedback
2. Implement Google Maps integration for route visualization
3. Add authentication with Replit Auth
4. Import real Kinab object data
