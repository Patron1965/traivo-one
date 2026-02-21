# Driver Core - Unicorn Field Service Mobile App

## Overview
Driver Core is a native mobile app (React Native/Expo) for field service drivers in the Unicorn platform. It connects to the existing Kinab Core Concept backend and provides drivers with a dedicated mobile experience for managing daily work orders, GPS tracking, material logging, deviation reporting, inspections, and more.

## Recent Changes
- 2026-02-21: Added task dependencies, execution codes, time restrictions, sub-steps, inspection checklists, order notes, PIN login, and offline indicator
- 2026-02-19: Initial project setup with full MVP feature set

## Project Architecture

### Stack
- **Frontend:** React Native with Expo SDK 54, TypeScript
- **Backend:** Express.js on port 5000
- **Frontend Dev Server:** Expo on port 8081
- **Database:** PostgreSQL (available via DATABASE_URL)
- **Navigation:** React Navigation 7 (native stack + bottom tabs)
- **State Management:** @tanstack/react-query
- **Fonts:** Inter (via @expo-google-fonts/inter)
- **Deployment:** Static JS bundles served via Express (exps:// protocol for Expo Go)

### Directory Structure
```
/
├── App.tsx                    # Root app component
├── app.json                   # Expo configuration
├── scripts/
│   └── build.sh               # Static bundle build script
├── dist/                      # Built bundles (ios/ and android/)
├── client/
│   ├── components/            # Reusable UI components
│   │   ├── Card.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── OfflineIndicator.tsx  # Network status bar
│   │   ├── StatusBadge.tsx
│   │   ├── ThemedText.tsx
│   │   └── ThemedView.tsx
│   ├── constants/
│   │   └── theme.ts           # Colors, Spacing, Typography
│   ├── context/
│   │   └── AuthContext.tsx     # Authentication state
│   ├── hooks/
│   │   └── useScreenOptions.ts
│   ├── lib/
│   │   └── query-client.ts    # API client & React Query setup
│   ├── navigation/
│   │   ├── RootNavigator.tsx   # Auth-conditional navigation
│   │   └── TabNavigator.tsx    # Bottom tab navigation
│   ├── screens/
│   │   ├── LoginScreen.tsx     # PIN + username/password login
│   │   ├── HomeScreen.tsx      # Dashboard with orders, weather, progress
│   │   ├── OrdersScreen.tsx    # Filterable order list
│   │   ├── OrderDetailScreen.tsx  # Order detail with sub-steps, notes, actions
│   │   ├── InspectionScreen.tsx   # 6-category inspection checklist
│   │   ├── MapScreen.tsx
│   │   ├── ProfileScreen.tsx
│   │   ├── ReportDeviationScreen.tsx
│   │   ├── MaterialLogScreen.tsx
│   │   ├── CameraCaptureScreen.tsx
│   │   └── SignatureScreen.tsx
│   └── types/
│       └── index.ts           # TypeScript type definitions
├── server/
│   ├── index.ts               # Express server entry (serves API + static bundles + landing page)
│   ├── routes/
│   │   └── mobile.ts          # Mobile API endpoints
│   └── templates/
│       └── landing-page.html  # QR code landing page for Expo Go
└── assets/                    # App icons and images
```

### API Endpoints (port 5000)
- `POST /api/mobile/login` - Driver authentication (supports `{pin}` or `{username, password}`)
- `GET /api/mobile/orders` - Get today's orders (includes dependencies, executionCodes, timeRestrictions, subSteps, orderNotes)
- `GET /api/mobile/orders/:id` - Get single order
- `PATCH /api/mobile/orders/:id/status` - Update order status
- `POST /api/mobile/orders/:id/deviations` - Report deviation
- `POST /api/mobile/orders/:id/materials` - Log material usage
- `POST /api/mobile/orders/:id/signature` - Save signature
- `POST /api/mobile/orders/:id/notes` - Add order note `{text}`
- `PATCH /api/mobile/orders/:id/substeps/:stepId` - Toggle sub-step `{completed}`
- `POST /api/mobile/orders/:id/inspections` - Save inspection results `{inspections[]}`
- `GET /api/mobile/articles?search=` - Search articles
- `POST /api/mobile/gps` - Submit GPS position
- `GET /api/mobile/weather` - Get weather (Open-Meteo API)
- `GET /api/mobile/summary` - Get daily summary

### Key Features
- PIN-based login (4-6 digits) alongside username/password authentication
- Daily order list with color-coded status badges and filtering
- Order detail view with 8-step status workflow (haptic feedback)
- Task dependencies: orders can depend on other orders; locked orders show red-tinted cards
- Execution codes: color-coded badges (TÖM, HÄMT, FARL, etc.) on order cards
- Time restrictions: pickup/delivery windows with warning indicators
- Sub-steps: expandable checklist items per order with progress tracking
- Order notes: drivers can write and view notes per order
- Inspection checklists: 6 categories (Tillgänglighet, Kärl/Behållare, Miljö, Säkerhet, Renlighet, Övrigt) with OK/Varning/Fel status, predefined issue badges, and comments
- Offline indicator: network status bar at top of app
- Route map view (native maps in Expo Go, web fallback list)
- Weather info from Open-Meteo with warnings
- Deviation reporting with GPS position
- Material logging with article autocomplete
- Camera integration for object photos
- Digital signature capture
- Contact info with one-tap calling
- Navigation to order locations
- What3Words position display

### Deployment
- Static bundles built with `bash scripts/build.sh` (iOS + Android)
- Bundles served from `/dist/` via Express on port 5000
- Landing page at root `/` with QR code for Expo Go access
- Expo Go connects via `exps://` protocol to platform-specific manifests
- Important: Users should use the QR code on the landing page, NOT the QR code from Replit's URL bar (that points to port 8081)

## User Preferences
- **Language:** Swedish (sv) for all UI
- **Design:** Clean Nordic aesthetic with Inter font
- **Colors:** Primary #1B4F72, Secondary #17A589
