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
8. **Modus 2.0 Import:** Direct import from Modus 2.0 CSV exports (semicolon-separated)

## Modus 2.0 Import System
Located at `/import` page. Supports importing:
- **Objekt:** Two-pass import (create objects, then update parent relationships). Auto-creates customers from unique Kund values.
- **Uppgifter (Tasks):** Links to objects by Modus ID. Auto-creates resources from Team field.
- **Händelser (Events):** Analyzes task events to calculate setup time statistics.

API Endpoints:
- `POST /api/import/modus/objects` - Import objects CSV
- `POST /api/import/modus/tasks` - Import tasks CSV  
- `POST /api/import/modus/events` - Analyze events CSV for setup times

Field Mappings (Modus → Nordic Routing):
- `Id` → objectNumber (prefixed with MODUS-)
- `Namn` → name
- `Typ` → objectType (mapped to system types)
- `Parent` → parentId (second pass)
- `Kund` → customerId (auto-created)
- `Latitud/Longitud` → coordinates (validated for Sweden bounds 55-70°N, 10-25°E)
- `Metadata - Nyckel eller kod` → accessType + accessCode/keyNumber
- `Metadata - Antal` → containerCount

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
- 2024-12-20: Added useObjectsByIds/useObjectSearch hooks for lazy object loading
- 2024-12-20: Optimized MobileFieldApp, Dashboard, OptimizationPrepPage, RouteMap, ProcurementsPage with lazy loading
- 2024-12-20: All components now use ID-based object fetching instead of loading all objects
- 2024-12-19: Added Modus 2.0 Import system (objects, tasks, events analysis)
- 2024-12-19: Increased upload limit to 50MB for large Modus exports
- 2024-12-19: Added "Inför Optimering" page for weekly optimization preparation
- 2024-12-19: Removed local optimization logic from RouteMap (external API integration)
- 2024-12-19: Landing page updated to "Optimera din Fältservice"
- 2024-12-17: Updated to Kinab's actual business domain (avfallshantering)
- 2024-12-17: Implemented hierarchical object structure (Område → Fastighet → Rum)
- 2024-12-17: Added Telgebostäder and Serviceboenden as customers
- 2024-12-17: Setup time logging from MobileFieldApp to database
- 2024-12-17: Dashboard uses real setup_time_logs data

## Optimization Patterns
### Lazy Object Loading
Components should NOT load all objects at once. Use the shared hooks in `client/src/hooks/useObjectSearch.ts`:

- **useObjectsByIds(objectIds)**: Fetch objects by specific IDs (for components that know which objects they need)
- **useObjectSearch({ selectedIds, enabled })**: For searchable dropdowns with debounced search

**Standard pattern for components:**
```typescript
// 1. Collect object IDs from workOrders/setupLogs/etc
const objectIdsNeeded = useMemo(() => {
  return workOrders.map(wo => wo.objectId).filter(Boolean);
}, [workOrders]);

// 2. Fetch only needed objects
const { data: objects = [] } = useObjectsByIds(objectIdsNeeded);

// 3. Create objectMap for lookups
const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);
```

**Components using this pattern:**
- MobileFieldApp (today's jobs only)
- Dashboard (setupLogs/workOrders references only)
- OptimizationPrepPage (week's jobs only)
- RouteMap (visible period only)
- ProcurementsPage (searchable dropdown)

## Development Checklists

### Adding a New Page
When creating a new page, ALWAYS complete these steps:
1. Create the page component in `client/src/pages/NewPage.tsx`
2. Import it in `client/src/App.tsx`
3. Add Route in the Router function: `<Route path="/new-page" component={NewPage} />`
4. Add sidebar navigation in `client/src/components/layout/AppSidebar.tsx`

### Current Routes (App.tsx)
| Path | Component | Description |
|------|-----------|-------------|
| `/` | WeekPlannerPage | Huvudvy - veckoplanering |
| `/planner` | WeekPlannerPage | Alias för veckoplanering |
| `/routes` | RoutesPage | Ruttvisualisering |
| `/optimization` | OptimizationPrepPage | Inför optimering |
| `/objects` | ObjectsPage | Objekthantering |
| `/resources` | ResourcesPage | Resurshantering |
| `/procurements` | ProcurementsPage | Inköp |
| `/dashboard` | DashboardPage | Analys |
| `/import` | ImportPage | Modus 2.0 import |
| `/settings` | SettingsPage | Inställningar |

## Next Steps
1. Import real Kinab object data from Modus 2.0
2. Integrate with external Nordic Routing optimization API
3. Integrate with DataClean service for data validation
4. Review and adjust data model based on Kinab feedback
