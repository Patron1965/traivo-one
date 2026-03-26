# Traivo Go - Field Service Mobile App

## Overview
Traivo Go is a native mobile application for field service drivers, built with React Native/Expo. It integrates with the Traivo backend to manage daily work orders, GPS tracking, material logging, deviation reporting, and inspections. The application aims to optimize field operations, improve driver efficiency, and enhance communication. Key capabilities include optimized routing, real-time updates, offline functionality, and AI-powered assistance for tasks like deviation analysis and voice commands.

## User Preferences
- **Language:** Swedish (sv) for all UI
- **Design:** Clean Nordic minimalism with Inter font
- **Colors:** Primary #1B4B6B (Deep Ocean Blue), Secondary #4A9B9B (Northern Teal), Accent #7DBFB0 (Aurora Green), Background #E8F4F8 (Arctic Ice), Text #2C3E50 (Midnight Navy), Muted #6B7C8C (Mountain Gray)
- **Brand:** Traivo Go with Traivo logo, Traivo One backend integration
- **Demo Area:** Södertälje (2 resources, 12 orders)

## System Architecture
The application uses React Native with Expo SDK 54 and TypeScript for the frontend, and an Express.js backend. Navigation is managed by React Navigation 7, and state by `@tanstack/react-query`. It supports PIN-based and username/password authentication with role-based access control for `technician`, `planner`, `admin`, `owner`, and `user` roles.

**Key Features:**
- **Order Management:** Daily order lists with status, filtering, swipe actions, and detailed views including sub-steps and notes.
- **Time Tracking:** Automatic time entries based on status changes (travel/on_site/working), with a live timer and daily summaries.
- **Customer Sign-Off:** Digital signature capture for order completion, including materials and deviations.
- **Routing & Navigation:** Geoapify integration for optimized, traffic-aware routes and map display.
- **Offline Capabilities:** Caching of map data, routes, and orders; outbox for offline operations; and sync status indicator.
- **GPS Tracking:** Foreground location tracking with backend reporting and online/offline toggle.
- **AI Integration ("Nordfield Assist"):** AI chat with streaming responses, voice commands (e.g., navigate, report deviation, on-site, complete order), haptic feedback, TTS confirmation, and AI image analysis for deviations.
- **Push Notifications:** Infrastructure for APNs/FCM, token registration, and notifications for order status changes.
- **Statistics Dashboard:** Visualizations of work time, orders, efficiency, and deviations with weekly/monthly views.
- **Checklists & Inspections:** Template-based inspections with photo uploads (before/after).
- **Team Support:** Create and manage teams, invite members, view shared team orders, and real-time updates via WebSockets.
- **Work Sessions:** Start, stop, pause, and resume work sessions.
- **Communication:** Real-time updates via Socket.io for order changes and notifications, with a WebSocket bridge to Traivo One.
- **Server Mode Detection:** Distinguishes between 'mock' and 'live' server modes with visual indicators.
- **Route Feedback:** Users can submit feedback on routes with ratings and comments.
- **Terminology:** Tenant-specific Swedish terminology support.
- **Auto-Logout:** Inactivity-based logout after 24 hours.
- **Customer Change Requests:** Submit and track customer-reported issues.
- **My Deviations:** View personal deviation history.
- **Carry-Over Orders:** Functionality to move uncompleted orders from previous days to the current day.
- **ETA SMS:** Send automatic ETA notifications to customers.
- **HomeScreen Enhancements:** Displays task summaries, weather, next order details, and notification bell with unread count.
- **Notification Center:** Centralized view for grouped notifications with various types and read/unread status.
- **Settings System:** Global settings for GPS tracking, notifications, haptics, offline mode, and map app preference.
- **Error Resilience:** Screen-specific and global error boundaries with retry mechanisms.
- **Distance API (R2):** Road-network based driving time calculations for accurate ETA.
- **Disruption Triggers (R3):** Monitors order progress to trigger alerts for delays or early completions, and enables reporting of resource unavailability.
- **Break Stops (R4):** Displays informational break stop suggestions on the map.
- **Feedback Loop (R5):** Automatic actual duration calculation and status updates on order completion.
- **Customer Notifications (R6):** Automated customer notification when order status changes to en_route/dispatched.

**Code Architecture:**
The server routes are modularized under `server/routes/mobile/`, covering authentication, teams, orders, work sessions, notifications, sync, routing, and miscellaneous functionalities. The HomeScreen is also highly modular, with components and utilities separated.

**Deployment:**
Static bundles for iOS and Android are built using `bash scripts/build.sh` and served via Express. Expo Go access is provided via a QR code.

## External Dependencies
- **Database:** PostgreSQL
- **Mapping & Routing:** Geoapify Routing API
- **AI Services:** OpenAI (GPT-5.2, gpt-4o-mini-transcribe)
- **Weather API:** Open-Meteo
- **Real-time Communication:** Socket.io