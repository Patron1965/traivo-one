# Driver Core - Unicorn Field Service Mobile App

## Overview
Driver Core is a native mobile app (React Native/Expo) for field service drivers in the Unicorn platform. It connects to the existing Kinab Core Concept backend and provides drivers with a dedicated mobile experience for managing daily work orders, GPS tracking, material logging, deviation reporting, and more.

## Recent Changes
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

### Directory Structure
```
/
├── App.tsx                    # Root app component
├── app.json                   # Expo configuration
├── client/
│   ├── components/            # Reusable UI components
│   │   ├── Card.tsx
│   │   ├── ErrorBoundary.tsx
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
│   │   ├── LoginScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── OrdersScreen.tsx
│   │   ├── OrderDetailScreen.tsx
│   │   ├── MapScreen.tsx
│   │   ├── ProfileScreen.tsx
│   │   ├── ReportDeviationScreen.tsx
│   │   ├── MaterialLogScreen.tsx
│   │   ├── CameraCaptureScreen.tsx
│   │   └── SignatureScreen.tsx
│   └── types/
│       └── index.ts           # TypeScript type definitions
├── server/
│   ├── index.ts               # Express server entry
│   ├── routes/
│   │   └── mobile.ts          # Mobile API endpoints
│   └── templates/
│       └── landing-page.html
└── assets/                    # App icons and images
```

### API Endpoints (port 5000)
- `POST /api/mobile/login` - Driver authentication
- `GET /api/mobile/orders` - Get today's orders
- `GET /api/mobile/orders/:id` - Get single order
- `PATCH /api/mobile/orders/:id/status` - Update order status
- `POST /api/mobile/orders/:id/deviations` - Report deviation
- `POST /api/mobile/orders/:id/materials` - Log material usage
- `POST /api/mobile/orders/:id/signature` - Save signature
- `GET /api/mobile/articles?search=` - Search articles
- `POST /api/mobile/gps` - Submit GPS position
- `GET /api/mobile/weather` - Get weather (Open-Meteo API)
- `GET /api/mobile/summary` - Get daily summary

### Key Features
- Login with token-based auth (stored in AsyncStorage)
- Daily order list with color-coded status badges and filtering
- Order detail view with 8-step status workflow (haptic feedback)
- Route map view (native maps in Expo Go, web fallback list)
- Weather info from Open-Meteo with warnings
- Deviation reporting with GPS position
- Material logging with article autocomplete
- Camera integration for object photos
- Digital signature capture
- Contact info with one-tap calling
- Navigation to order locations
- What3Words position display

## User Preferences
- **Language:** Swedish (sv) for all UI
- **Design:** Clean Nordic aesthetic with Inter font
- **Colors:** Primary #1B4F72, Secondary #17A589
