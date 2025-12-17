# Nordic Routing - AI-Driven Field Service Planning Platform

## Overview
Nordic Routing is an AI-driven planning platform designed to optimize "ställtid" (setup time) for field service companies in the Nordic market. The platform targets the 15-25% of workday lost to setup inefficiencies (gate access, parking, finding keys).

**Design Partner:** Kinab AB (well-service company)
**Goal:** Prove value through measurable savings before scaling to commercial multi-tenant SaaS

## Current State
- **Phase:** Frontend Prototype Development
- **Status:** Functional UI prototype with mock data
- **Stack:** React + TypeScript + Vite + Express + PostgreSQL + Drizzle ORM

## Project Structure
```
client/src/
├── components/
│   ├── layout/
│   │   └── AppSidebar.tsx       # Main navigation sidebar
│   ├── examples/                 # Component examples for testing
│   ├── WeekPlanner.tsx          # Drag-drop weekly scheduling view
│   ├── ObjectCard.tsx           # Object display with setup time info
│   ├── RouteMap.tsx             # Route optimization view
│   ├── Dashboard.tsx            # Analytics and KPIs
│   ├── MobileFieldApp.tsx       # Field technician mobile interface
│   ├── ResourceList.tsx         # Resource/technician management
│   ├── JobModal.tsx             # Create/edit job modal
│   └── ThemeToggle.tsx          # Light/dark theme toggle
├── pages/
│   ├── WeekPlannerPage.tsx      # Main planning view
│   ├── RoutesPage.tsx           # Route optimization
│   ├── ObjectsPage.tsx          # Object management
│   ├── ResourcesPage.tsx        # Resource management
│   ├── DashboardPage.tsx        # Analytics dashboard
│   └── SettingsPage.tsx         # User/company settings
└── App.tsx                       # Main app with sidebar layout

server/
├── index.ts                      # Express server entry
├── routes.ts                     # API routes (to be implemented)
├── storage.ts                    # Storage interface
└── db.ts                         # Database connection

shared/
└── schema.ts                     # Drizzle schema (to be implemented)
```

## Key Features (Prototype)
1. **Veckoplanering (Week Planner):** Drag-drop scheduling with priority colors
2. **Ruttplanering (Route Map):** Route optimization with drive time visualization
3. **Objekt (Objects):** Customer objects with setup time tracking
4. **Resurser (Resources):** Technician management with competencies
5. **Dashboard:** KPIs, setup time analysis, AI insights
6. **Mobile Field App:** Technician interface with access info display

## Database Schema (Planned)
- tenants, users, customers, objects, resources, work_orders
- Analytics tables: setup_time_logs, route_logs
- Full migration files ready for deployment

## User Preferences
- **Language:** Swedish (sv) for UI, documentation in Swedish/English
- **Design:** Clean, professional Nordic aesthetic
- **Theme:** Dark/light mode support
- **Font:** Inter for UI, JetBrains Mono for code/numbers

## Recent Changes
- 2024-12-17: Created all frontend prototype components
- 2024-12-17: Implemented sidebar navigation with Shadcn
- 2024-12-17: Added mock data for testing UI flows
- 2024-12-17: Set up all pages with routing

## Next Steps
1. User review and approval of frontend prototype
2. Implement database schema with Drizzle migrations
3. Connect frontend to real backend APIs
4. Implement authentication with Replit Auth
5. Add Google Maps integration for route visualization
