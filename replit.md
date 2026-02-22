# Driver Core - Unicorn Field Service Mobile App

## Overview
Driver Core is a native mobile app (React Native/Expo) for field service drivers in the Unicorn platform. It connects to the existing Kinab Core Concept backend and provides drivers with a dedicated mobile experience for managing daily work orders, GPS tracking, material logging, deviation reporting, inspections, and more.

## Recent Changes
- 2026-02-22: Kinab Core Concept integration: new status workflow (planned→dispatched→on_site→in_progress→completed/failed), /my-orders endpoint, resource-based auth (POST login returns {success, token, resource}), POST /logout, GET /me, notifications API, offline sync POST /sync, template-based checklists GET /orders/:id/checklist, presigned photo URLs, /position GPS endpoint, enriched orders with object/customer data
- 2026-02-22: Added job markers on planner map with color-coded status, filter buttons (Idag/Denna vecka/Dölj jobb), cluster grouping, detailed popups with order info; GET /api/planner/orders endpoint with range=today|week
- 2026-02-22: Added planner map view (/planner/map) with Leaflet/OpenStreetMap showing real-time driver GPS positions; driver_locations table in PostgreSQL; auto-refresh every 15s; sidebar with driver list
- 2026-02-22: Switched from expo export (.hbc) to Metro-fetched JS bundles for Expo Go compatibility; manifest protocol v0; QR code uses exps:// for HTTPS; bundles in dist-metro/
- 2026-02-21: Added AI features: Unicorn Assist chat (GPT-5.2), voice input (gpt-4o-mini-transcribe), AI image analysis for deviations, AI context tips on order detail
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
- **AI Integration:** OpenAI via Replit AI Integrations (GPT-5.2, gpt-4o-mini-transcribe)
- **Deployment:** Metro-fetched JS bundles in dist-metro/ served via Express; manifest protocol v0; exps:// for Expo Go

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
│   │   ├── AIAssistantScreen.tsx     # Unicorn Assist chat + voice
│   │   ├── ReportDeviationScreen.tsx  # With AI image analysis
│   │   ├── MaterialLogScreen.tsx
│   │   ├── CameraCaptureScreen.tsx
│   │   └── SignatureScreen.tsx
│   └── types/
│       └── index.ts           # TypeScript type definitions
├── server/
│   ├── index.ts               # Express server entry (serves API + static bundles + landing page)
│   ├── db.ts                  # PostgreSQL connection pool
│   ├── routes/
│   │   └── mobile.ts          # Mobile API endpoints
│   │   └── ai.ts              # AI endpoints (chat, transcribe, analyze-image)
│   │   └── planner.ts         # Planner API endpoints (driver locations)
│   └── templates/
│       └── landing-page.html  # QR code landing page for Expo Go
│       └── planner-map.html   # Live driver map for planners (Leaflet/OpenStreetMap)
└── assets/                    # App icons and images
```

### API Endpoints (port 5000)
- `POST /api/mobile/login` - Driver authentication (supports `{pin}` or `{username, password}`), returns `{success, token, resource}`
- `POST /api/mobile/logout` - End session
- `GET /api/mobile/me` - Validate token, returns `{success, resource}`
- `GET /api/mobile/my-orders?date=` - Get orders for date (default today), enriched with object/customer data
- `GET /api/mobile/orders/:id` - Get single order
- `GET /api/mobile/orders/:id/checklist` - Get template-based checklist for order
- `PATCH /api/mobile/orders/:id/status` - Update order status (planned→dispatched→on_site→in_progress→completed/failed)
- `POST /api/mobile/orders/:id/deviations` - Report deviation
- `POST /api/mobile/orders/:id/materials` - Log material usage
- `POST /api/mobile/orders/:id/signature` - Save signature
- `POST /api/mobile/orders/:id/notes` - Add order note `{text}`
- `PATCH /api/mobile/orders/:id/substeps/:stepId` - Toggle sub-step `{completed}`
- `POST /api/mobile/orders/:id/inspections` - Save inspection results `{inspections[]}`
- `POST /api/mobile/orders/:id/upload-photo` - Get presigned URL for photo upload
- `POST /api/mobile/orders/:id/confirm-photo` - Confirm uploaded photo
- `GET /api/mobile/notifications` - Get notifications
- `PATCH /api/mobile/notifications/:id/read` - Mark notification as read
- `PATCH /api/mobile/notifications/read-all` - Mark all notifications read
- `POST /api/mobile/sync` - Offline sync batch `{actions[]}`
- `POST /api/mobile/position` - Submit GPS position (resource-based)
- `GET /api/mobile/articles?search=` - Search articles
- `POST /api/mobile/gps` - Submit GPS position (legacy)
- `GET /api/mobile/weather` - Get weather (Open-Meteo API)
- `GET /api/mobile/summary` - Get daily summary (totalOrders, completedOrders, remainingOrders, failedOrders, totalDuration)
- `POST /api/mobile/ai/chat` - AI chat `{message, context?}` (GPT-5.2)
- `POST /api/mobile/ai/transcribe` - Voice transcription `{audio: base64}` (gpt-4o-mini-transcribe)
- `POST /api/mobile/ai/analyze-image` - AI image analysis `{image: base64, context?}` (GPT-5.2 vision)
- `GET /api/planner/drivers/locations` - Get all active driver GPS positions (last 24h)
- `GET /planner/map` - Live driver map web page (Leaflet/OpenStreetMap, auto-refresh 15s)

### Database Tables
- `driver_locations` - Stores latest GPS position per driver (driver_id UNIQUE, lat/lng, speed, heading, status, current_order)

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
- **AI: Unicorn Assist** - Chat assistant (GPT-5.2) with order context, quick actions, Swedish responses
- **AI: Voice input** - Push-to-talk transcription (gpt-4o-mini-transcribe), web MediaRecorder + native expo-av
- **AI: Image analysis** - Photo analysis for deviation reporting, auto-fills category and description
- **AI: Context tips** - Per-order AI summaries and practical advice in modal overlay

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
