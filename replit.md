# Nordfield - Field Service Mobile App

## Overview
Nordfield is a native mobile application built with React Native/Expo, designed for field service drivers. It integrates with the Kinab Core Concept backend to provide a dedicated mobile experience for managing daily work orders, GPS tracking, material logging, deviation reporting, and inspections. The application aims to streamline field operations, improve driver efficiency, and enhance communication with the central system. Key capabilities include optimized routing, real-time updates, offline functionality, and AI-powered assistance for tasks like deviation analysis and voice commands.

## User Preferences
- **Language:** Swedish (sv) for all UI
- **Design:** Clean Nordic minimalism with Inter font, warm accents sparingly
- **Colors:** Primary #EA580C (burnt orange), Secondary #991B1B (burgundy), Accent #F59E0B (amber)
- **Brand:** Nordfield with compass rose logo, "Midnight Sun" color scheme

## System Architecture
The application is built using React Native with Expo SDK 54 and TypeScript for the frontend, and an Express.js backend. Navigation is handled by React Navigation 7, and state management is powered by `@tanstack/react-query`. The system supports both PIN-based and username/password authentication.

**Key Features:**
- **Order Management:** Daily order lists with status badges, filtering, swipe gestures for status updates and deviation reporting, and detailed order views with sub-steps, notes, and task dependencies.
- **Routing & Navigation:** Integration with Geoapify Routing API for optimized routes, traffic-aware travel time estimation, and a map view displaying custom markers, driver start positions, and route polylines.
- **Offline Capabilities:** Offline map data caching, offline sync for outbox operations, and robust handling of network disconnections.
- **GPS Tracking:** Foreground location tracking with regular reporting to the backend, and an online/offline toggle that affects driver visibility on the planner map.
- **AI Integration:** "Unicorn Assist" chat (GPT-5.2), voice commands for hands-free operation, AI image analysis for deviation reporting, and context-aware AI tips.
- **Checklists & Inspections:** Template-based inspection checklists, including requirements for photo uploads (before/after).
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