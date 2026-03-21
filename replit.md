# Traivo Go - Field Service Mobile App

## Overview
Traivo Go is a native mobile application built with React Native/Expo, designed for field service drivers. It integrates with the Traivo backend to provide a dedicated mobile experience for managing daily work orders, GPS tracking, material logging, deviation reporting, and inspections. The application aims to streamline field operations, improve driver efficiency, and enhance communication with the central system. Key capabilities include optimized routing, real-time updates, offline functionality, and AI-powered assistance for tasks like deviation analysis and voice commands.

## User Preferences
- **Language:** Swedish (sv) for all UI
- **Design:** Clean Nordic minimalism with Inter font
- **Colors:** Primary #1B4B6B (Deep Ocean Blue), Secondary #4A9B9B (Northern Teal), Accent #7DBFB0 (Aurora Green), Background #E8F4F8 (Arctic Ice), Text #2C3E50 (Midnight Navy), Muted #6B7C8C (Mountain Gray)
- **Brand:** Traivo Go with Traivo logo, Traivo backend integration

## System Architecture
The application is built using React Native with Expo SDK 54 and TypeScript for the frontend, and an Express.js backend. Navigation is handled by React Navigation 7, and state management is powered by `@tanstack/react-query`. The system supports both PIN-based and username/password authentication.

**Role-Based Access Control:**
- 8 roles: `owner`, `admin`, `planner`, `technician`, `user`, `viewer`, `customer`, `reporter`
- Field app access allowed for: `technician`, `planner`, `admin`, `owner`, `user`
- Blocked roles (`customer`, `reporter`, `viewer`) see `UnauthorizedScreen` with logout option
- Role constants defined in `client/types/index.ts` (`FIELD_APP_ALLOWED_ROLES`, `FIELD_APP_BLOCKED_ROLES`)
- Role check in `RootNavigator.tsx` gates access to main app vs unauthorized screen
- Login stores user with role; blocked roles skip push token registration and profile fetching

**Key Features:**
- **Order Management:** Daily order lists with status badges, filtering, swipe gestures for status updates and deviation reporting, and detailed order views with sub-steps, notes, and task dependencies.
- **Time Tracking:** Automatic time entries created on status changes (travel/on_site/working phases). Live timer on OrderDetailScreen during active work. Time breakdown per phase on completed orders. Daily work time summary on HomeScreen. Database table `time_entries`.
- **Customer Sign-Off:** CustomerSignOffScreen with order summary, materials used, deviations, signature pad, and customer name input. POST endpoint for sign-off data. Accessible from OrderDetailScreen when order is in_progress or completed.
- **Routing & Navigation:** Integration with Geoapify Routing API for optimized routes, traffic-aware travel time estimation (`traffic=approximated`), and a map view displaying custom markers, driver start positions, and route polylines.
- **Offline Capabilities:** Offline map data caching (route polylines + order data in AsyncStorage, 24h TTL), offline sync for outbox operations, and robust handling of network disconnections. Sync status indicator (green/yellow/red dot) on HomeScreen.
- **GPS Tracking:** Foreground location tracking with regular reporting to the backend via both `POST /position` and `POST /gps` endpoints, and an online/offline toggle that affects driver visibility on the planner map.
- **AI Integration:** "Nordfield Assist" chat (GPT-5.2) with **streaming responses** (SSE via `/api/mobile/ai/chat/stream`, word-by-word display using `expo/fetch` getReader), enhanced voice commands with FAB button, silence detection, haptic feedback (expo-haptics), TTS confirmation (expo-speech), recording overlay modal, 10 voice commands (navigate_orders, start_next, report_deviation, on_site, complete_order, navigate_to, call_customer, start_break, navigate_statistics, help), offline keyword fallback, and AI image analysis for deviation reporting.
- **Push Notifications:** Infrastructure ready for standalone builds (APNs/FCM). Database table `push_tokens`, Expo Push API integration, token registration on login, notifications on order status changes.
- **Statistics Dashboard:** StatisticsScreen with week/month toggle, stacked bar chart (travel/on-site/working per day), summary cards (orders, efficiency, deviations, sign-offs), trend indicators vs previous period. Accessible from HomeScreen and ProfileScreen. GET `/api/mobile/statistics` endpoint.
- **Checklists & Inspections:** Template-based inspection checklists with photo uploads (before/after). Photos converted to base64 on device via expo-file-system and uploaded to POST `/api/mobile/inspections/:orderId/photos`. Database table `inspection_photos` stores photos with order_id, category, photo_slot. GET endpoint retrieves stored photos. Upload progress shown in save button, errors displayed in Swedish alerts. Max 5 MB per photo.
- **Team Support:** Full team management via dedicated TeamScreen (`client/screens/TeamScreen.tsx`). Create teams with name/description/color, invite members via search, leave or delete teams. Shared team orders view with assignee names. `GET /api/mobile/my-team`, `POST /api/mobile/teams`, `POST /teams/:id/invite`, `POST /teams/:id/accept`, `POST /teams/:id/leave`, `DELETE /teams/:id`, `GET /resources/search`, `GET /team-invites`, `GET /team-orders` endpoints. `useTeam` hook with AsyncStorage cache. ProfileScreen "Mitt team" section navigates to TeamScreen. HomeScreen team partner banner. MapScreen partner marker. WebSocket events for real-time team updates (`team:invite`, `team:member_left`, `team:order_updated`, `team:material_logged`). Types: `Team`, `TeamMember`, `TeamMemberRole` in `client/types/index.ts`.
- **Work Sessions (Arbetspass):** Start/stop/pause/resume work sessions via `/api/mobile/work-sessions/*`. `useWorkSession` hook with live timer, mutation helpers. Session entries for time logging per work type.
- **Communication:** Real-time updates via WebSocket (Socket.io) for order changes and notifications. Extended Traivo WS events: `job_assigned`, `job_updated`, `job_cancelled`, `schedule_changed`, `priority_changed`, `anomaly_alert`, `position_update`, `ping/pong` keepalive.
- **Route Feedback:** RouteFeedbackScreen with 1-5 star rating, reason categories (too long, too short, logical, illogical, good, traffic), and comment field. Database table `route_feedback`. Accessible from ProfileScreen. GET `/api/mobile/route-feedback/mine` and POST `/api/mobile/route-feedback` endpoints.
- **Terminology:** GET `/api/mobile/terminology` endpoint returning tenant-specific Swedish terms. Falls back to built-in defaults in mock mode, forwards to Traivo API in production.
- **Auto-Logout:** 24-hour inactivity timeout. Activity recorded on login, app foregrounding, and API interactions. Checked every 5 minutes and on app state changes.
- **Branding & UI:** Rebranded to "Traivo Go" with Traivo logo, "Midnight Sun" color scheme, custom icons, and a focus on intuitive UI/UX across screens like Profile, AI Assistant, and Orders.

**Deployment:**
Static bundles are built for iOS and Android using `bash scripts/build.sh` and served via Express. Expo Go access is provided via a QR code on a landing page, connecting through the `exps://` protocol.

## External Dependencies
- **Database:** PostgreSQL
- **Mapping & Routing:** Geoapify Routing API
- **AI Services:** OpenAI (GPT-5.2, gpt-4o-mini-transcribe) via Replit AI Integrations
- **Weather API:** Open-Meteo
- **Real-time Communication:** Socket.io
- **Analytics/Monitoring:** Sentry (implied by error logging and performance audit)
