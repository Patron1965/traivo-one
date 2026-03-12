# Nordnav Go - Field Service Mobile App

## Overview
Nordnav Go is a native mobile application built with React Native/Expo, designed for field service drivers. It integrates with the Kinab Core Concept backend to provide a dedicated mobile experience for managing daily work orders, GPS tracking, material logging, deviation reporting, and inspections. The application aims to streamline field operations, improve driver efficiency, and enhance communication with the central system. Key capabilities include optimized routing, real-time updates, offline functionality, and AI-powered assistance for tasks like deviation analysis and voice commands.

## User Preferences
- **Language:** Swedish (sv) for all UI
- **Design:** Clean Nordic minimalism with Inter font
- **Colors:** Primary #1B4B6B (Deep Ocean Blue), Secondary #4A9B9B (Northern Teal), Accent #7DBFB0 (Aurora Green), Background #E8F4F8 (Arctic Ice), Text #2C3E50 (Midnight Navy), Muted #6B7C8C (Mountain Gray)
- **Brand:** Nordnav Go with mountain/navigation logo, "Nordnav One" color scheme

## System Architecture
The application is built using React Native with Expo SDK 54 and TypeScript for the frontend, and an Express.js backend. Navigation is handled by React Navigation 7, and state management is powered by `@tanstack/react-query`. The system supports both PIN-based and username/password authentication.

**Key Features:**
- **Order Management:** Daily order lists with status badges, filtering, swipe gestures for status updates and deviation reporting, and detailed order views with sub-steps, notes, and task dependencies.
- **Time Tracking:** Automatic time entries created on status changes (travel/on_site/working phases). Live timer on OrderDetailScreen during active work. Time breakdown per phase on completed orders. Daily work time summary on HomeScreen. Database table `time_entries`.
- **Customer Sign-Off:** CustomerSignOffScreen with order summary, materials used, deviations, signature pad, and customer name input. POST endpoint for sign-off data. Accessible from OrderDetailScreen when order is in_progress or completed.
- **Routing & Navigation:** Integration with Geoapify Routing API for optimized routes, traffic-aware travel time estimation (`traffic=approximated`), and a map view displaying custom markers, driver start positions, and route polylines.
- **Offline Capabilities:** Offline map data caching (route polylines + order data in AsyncStorage, 24h TTL), offline sync for outbox operations, and robust handling of network disconnections.
- **GPS Tracking:** Foreground location tracking with regular reporting to the backend, and an online/offline toggle that affects driver visibility on the planner map.
- **AI Integration:** "Nordfield Assist" chat (GPT-5.2) with **streaming responses** (SSE via `/api/mobile/ai/chat/stream`, word-by-word display using `expo/fetch` getReader), enhanced voice commands with FAB button, silence detection, haptic feedback (expo-haptics), TTS confirmation (expo-speech), recording overlay modal, 10 voice commands (navigate_orders, start_next, report_deviation, on_site, complete_order, navigate_to, call_customer, start_break, navigate_statistics, help), offline keyword fallback, and AI image analysis for deviation reporting.
- **Push Notifications:** Infrastructure ready for standalone builds (APNs/FCM). Database table `push_tokens`, Expo Push API integration, token registration on login, notifications on order status changes.
- **Statistics Dashboard:** StatisticsScreen with week/month toggle, stacked bar chart (travel/on-site/working per day), summary cards (orders, efficiency, deviations, sign-offs), trend indicators vs previous period. Accessible from HomeScreen and ProfileScreen. GET `/api/mobile/statistics` endpoint.
- **Checklists & Inspections:** Template-based inspection checklists with photo uploads (before/after). Photos converted to base64 on device via expo-file-system and uploaded to POST `/api/mobile/inspections/:orderId/photos`. Database table `inspection_photos` stores photos with order_id, category, photo_slot. GET endpoint retrieves stored photos. Upload progress shown in save button, errors displayed in Swedish alerts. Max 5 MB per photo.
- **Team Support:** Team info display (partner name, phone, online status, GPS position on map). `GET /api/mobile/my-team` endpoint with mock data. `useTeam` hook with AsyncStorage cache (`@my_team`). ProfileScreen "Mitt team" section with member list, role badges, and call buttons. HomeScreen team partner banner. MapScreen partner marker. Types: `Team`, `TeamMember`, `TeamMemberRole` in `client/types/index.ts`.
- **Communication:** Real-time updates via WebSocket (Socket.io) for order changes and notifications.
- **Branding & UI:** Rebranded to "Nordfield" with a "Midnight Sun" color scheme, custom icons, and a focus on intuitive UI/UX across screens like Profile, AI Assistant, and Orders.

**Deployment:**
Static bundles are built for iOS and Android using `bash scripts/build.sh` and served via Express. Expo Go access is provided via a QR code on a landing page, connecting through the `exps://` protocol.

## External Dependencies
- **Database:** PostgreSQL
- **Mapping & Routing:** Geoapify Routing API
- **AI Services:** OpenAI (GPT-5.2, gpt-4o-mini-transcribe) via Replit AI Integrations
- **Weather API:** Open-Meteo
- **Real-time Communication:** Socket.io
- **Analytics/Monitoring:** Sentry (implied by error logging and performance audit)