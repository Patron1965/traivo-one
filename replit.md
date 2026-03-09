# Nordfield - Field Service Mobile App

## Overview
Nordfield is a native mobile app (React Native/Expo) for field service drivers. It connects to the existing Kinab Core Concept backend and provides drivers with a dedicated mobile experience for managing daily work orders, GPS tracking, material logging, deviation reporting, inspections, and more.

## Recent Changes
- 2026-03-09: Added /support page (server/templates/support.html) for App Store listing — FAQ, contact info, Nordfield branding
- 2026-03-09: Comprehensive bug & performance audit (T001-T010): Server bundle caching with mtime invalidation, app.json cached at startup, input validation on status/position/GPS/AI endpoints, error logging in all catch blocks, base64 payload size limits on AI routes. Client: AuthContext race condition fix, WebSocket reconnection backoff, GPS tracking refactored to singleton (prevents duplicate intervals), offline sync mutex + storage limits, OrdersScreen/OrderDetailScreen memoized sub-components, AIAssistantScreen FlatList with inverted pattern, MaterialLogScreen debounced search, SignatureScreen imperative SVG drawing, query-client consistent error handling.
- 2026-03-08: Rebranded from "Driver Core" / "Unicorn" to "Nordfield" with "Midnight Sun" color scheme (primary: #EA580C burnt orange, secondary: #991B1B burgundy, accent: #F59E0B amber). New compass rose logo/icons. Updated all UI strings, templates, AI assistant name, error boundary, and server branding.
- 2026-03-06: ProfileScreen: initials avatar, online/offline toggle badge, today's stats row (completed/total/remaining), colored icon backgrounds, phone/email always shown with tap-to-call/email, logout confirmation modal, version text
- 2026-03-06: AIAssistantScreen: redesigned avatar (teal zap icon), compact message bubbles, suggestion cards grid on empty state, 5 quick action chips, always-visible send button, mic button on left, animated typing indicator
- 2026-03-06: MapScreen: custom numbered markers with customer name labels, driver start position marker (green), route polyline with glow outline, callout popups with order details on tap, expandable legend with per-leg travel times
- 2026-03-06: OrdersScreen: vertical timeline connector between cards, contextual badge descriptions (dependency order numbers, time restriction details), consistent progress bars on all cards, animated pulsing swipe hint on first card, increased text display (2-line customer name & description), clarified travel time ("X min dit") vs job duration (briefcase icon)
- 2026-03-06: Added optimized route with real road polylines on MapScreen using OSRM (free routing API), shows total distance/duration, optimized stop order
- 2026-02-26: Dynamic domain injection in Metro bundles for deployment compatibility; hardened login with mock fallback; robust root endpoint error handling
- 2026-02-25: Removed team chat feature (TeamChatScreen, team_messages table, team-chat endpoints)
- 2026-02-25: Completed orders now visually distinct: green check circle, tinted background, muted text
- 2026-02-25: Auto-navigate back to order list after completing a job
- 2026-02-25: Added 7 new features: enhanced daily summary with weather, swipe gestures on order cards, travel time estimation, photo-required checklists, smart break suggestions, voice commands, AI-powered deviation reports
- 2026-02-25: Fixed order status flow for drivers: planned→dispatched→on_site→in_progress→completed with descriptive sub-labels
- 2026-02-25: Added online/offline toggle with green/grey dot indicator, persists via AsyncStorage, filters driver from planner map
- 2026-02-23: GPS tracking hook (useGpsTracking) with foreground location, 30s interval reporting to /position endpoint, permission handling for web and native
- 2026-02-23: WebSocket real-time updates via Socket.io (useWebSocket hook); server emits order:updated, order:assigned, notification events; auto-invalidates React Query cache
- 2026-02-23: Presigned URL photo upload flow in CameraCaptureScreen: camera/gallery → upload-photo → PUT to presigned URL → confirm-photo, with per-photo upload status indicators
- 2026-02-22: Kinab Core Concept integration: new status workflow, /my-orders endpoint, resource-based auth, notifications API, offline sync, template-based checklists, presigned photo URLs, /position GPS endpoint
- 2026-02-22: Added planner map view (/planner/map) with Leaflet/OpenStreetMap showing real-time driver GPS positions
- 2026-02-21: Added AI features: Unicorn Assist chat (GPT-5.2), voice input, AI image analysis for deviations, AI context tips
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
│   │   ├── useScreenOptions.ts
│   │   ├── useGpsTracking.ts   # GPS tracking with location permissions
│   │   ├── useWebSocket.ts     # Socket.io real-time updates
│   │   └── useOfflineSync.ts   # Offline outbox sync
│   ├── lib/
│   │   ├── query-client.ts    # API client & React Query setup
│   │   └── travel-time.ts     # Haversine distance & travel time estimation
│   ├── navigation/
│   │   ├── RootNavigator.tsx   # Auth-conditional navigation
│   │   └── TabNavigator.tsx    # Bottom tab navigation
│   ├── screens/
│   │   ├── LoginScreen.tsx     # PIN + username/password login
│   │   ├── HomeScreen.tsx      # Dashboard with weather, progress, break suggestions, voice FAB, chat FAB
│   │   ├── OrdersScreen.tsx    # Filterable order list with swipe gestures
│   │   ├── OrderDetailScreen.tsx  # Order detail with sub-steps, notes, travel time, actions
│   │   ├── InspectionScreen.tsx   # 6-category inspection with photo requirements
│   │   ├── MapScreen.tsx
│   │   ├── ProfileScreen.tsx
│   │   ├── AIAssistantScreen.tsx     # Unicorn Assist chat + voice
│   │   ├── ReportDeviationScreen.tsx  # With auto AI image analysis
│   │   ├── MaterialLogScreen.tsx
│   │   ├── CameraCaptureScreen.tsx
│   │   └── SignatureScreen.tsx
│   └── types/
│       └── index.ts           # TypeScript type definitions
├── server/
│   ├── index.ts               # Express server entry
│   ├── db.ts                  # PostgreSQL connection pool
│   ├── routes/
│   │   ├── mobile.ts          # Mobile API endpoints
│   │   ├── ai.ts              # AI endpoints (chat, transcribe, analyze-image, voice-command)
│   │   └── planner.ts         # Planner API endpoints
│   └── templates/
│       ├── landing-page.html  # QR code landing page for Expo Go
│       └── planner-map.html   # Live driver map for planners
└── assets/                    # App icons and images
```

### API Endpoints (port 5000)
- `POST /api/mobile/login` - Driver authentication (supports `{pin}` or `{username, password}`)
- `POST /api/mobile/logout` - End session
- `GET /api/mobile/me` - Validate token
- `GET /api/mobile/my-orders?date=` - Get orders for date (default today)
- `GET /api/mobile/orders/:id` - Get single order
- `GET /api/mobile/orders/:id/checklist` - Get template-based checklist (with photo requirements)
- `PATCH /api/mobile/orders/:id/status` - Update order status
- `POST /api/mobile/orders/:id/deviations` - Report deviation
- `POST /api/mobile/orders/:id/materials` - Log material usage
- `POST /api/mobile/orders/:id/signature` - Save signature
- `POST /api/mobile/orders/:id/notes` - Add order note
- `PATCH /api/mobile/orders/:id/substeps/:stepId` - Toggle sub-step
- `POST /api/mobile/orders/:id/inspections` - Save inspection results
- `POST /api/mobile/orders/:id/upload-photo` - Get presigned URL for photo upload
- `POST /api/mobile/orders/:id/confirm-photo` - Confirm uploaded photo
- `GET /api/mobile/notifications` - Get notifications
- `PATCH /api/mobile/notifications/:id/read` - Mark notification as read
- `PATCH /api/mobile/notifications/read-all` - Mark all notifications read
- `POST /api/mobile/sync` - Offline sync batch
- `POST /api/mobile/position` - Submit GPS position
- `POST /api/mobile/status` - Update online/offline status
- `GET /api/mobile/articles?search=` - Search articles
- `GET /api/mobile/weather` - Get weather (Open-Meteo API)
- `GET /api/mobile/summary` - Get daily summary (includes totalDistance)
- `GET /api/mobile/route?coords=lon,lat;lon,lat;...` - Get optimized route via OSRM (GeoJSON polyline, distance, duration)
- `POST /api/mobile/ai/chat` - AI chat (GPT-5.2)
- `POST /api/mobile/ai/transcribe` - Voice transcription (gpt-4o-mini-transcribe)
- `POST /api/mobile/ai/analyze-image` - AI image analysis with severity + confidence
- `POST /api/mobile/ai/voice-command` - Voice command recognition (transcribe + classify intent)
- `GET /api/planner/drivers/locations` - Get active driver GPS positions
- `GET /planner/map` - Live driver map web page

### Database Tables
- `driver_locations` - Stores latest GPS position per driver

### Key Features
- PIN-based login (4-6 digits) alongside username/password authentication
- Online/offline toggle with green/grey dot indicator
- Daily order list with color-coded status badges, filtering, and swipe gestures
- **Swipe gestures**: swipe right = advance status, swipe left = report deviation
- **Travel time estimation**: Haversine-based ~X min badges on order cards
- Order detail view with driver-specific status flow (Starta körning → På plats → Utför → Slutför)
- Task dependencies, execution codes, time restrictions
- Sub-steps with progress tracking, order notes
- **Inspection checklists with photo requirements**: some categories require before/after photos
- **Smart break suggestions**: after 4h continuous work, shows schedule gap info
- Route map view, weather info with warnings
- Deviation reporting with GPS position
- Material logging with article autocomplete
- Camera integration, digital signature capture
- Contact info with one-tap calling, navigation to locations
- What3Words position display
- **AI: Unicorn Assist** - Chat assistant with order context
- **AI: Voice commands** - Hands-free "Starta nästa jobb", "Rapportera avvikelse", "Jag är på plats" etc.
- **AI: Auto deviation analysis** - Photo triggers automatic AI categorization with confidence + severity
- **AI: Context tips** - Per-order AI summaries

### Deployment
- Static bundles built with `bash scripts/build.sh` (iOS + Android)
- Bundles served from `/dist/` via Express on port 5000
- Landing page at root `/` with QR code for Expo Go access
- Expo Go connects via `exps://` protocol to platform-specific manifests
- Important: Users should use the QR code on the landing page, NOT the QR code from Replit's URL bar (that points to port 8081)

## User Preferences
- **Language:** Swedish (sv) for all UI
- **Design:** Clean Nordic minimalism with Inter font, warm accents sparingly
- **Colors:** Primary #EA580C (burnt orange), Secondary #991B1B (burgundy), Accent #F59E0B (amber)
- **Brand:** Nordfield with compass rose logo, "Midnight Sun" color scheme
