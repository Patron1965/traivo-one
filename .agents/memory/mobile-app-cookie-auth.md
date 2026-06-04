---
name: Mobile-app (SimpleFieldApp) auth surface
description: Vilken auth/endpoint-yta Traivos mobil-UI faktiskt använder
---
Traivos "mobile" fält-app (`client/src/components/SimpleFieldApp.tsx`) renderas i en
vanlig webbläsar-session med **cookie-auth (Replit Auth)**, inte som en separat
bearer-token-klient. Den blandar `mobileApiCall` för vissa endpoints med vanliga
cookie-autentiserade `fetch`/`apiRequest`-anrop mot `/api/objects`, `/api/work-orders` m.fl.

**Why:** Släktnamn behövde visas i mobil-UI. `/api/objects/:id/display-names`
ligger bakom normal tenant-middleware (cookie-auth), INTE under `/api/mobile/*`.
Eftersom mobil-appen ändå kör i cookie-session funkar samma endpoint i både web och
mobil — ingen separat `/api/mobile/*`-endpoint behövdes.

**How to apply:** När du lägger till data i mobil-fält-appen, återanvänd vanliga
cookie-autade `/api/*`-endpoints om de redan finns. Lägg bara till `/api/mobile/*`
(bearer) när funktionen faktiskt körs som fristående bearer-token-klient utanför
webbsessionen.
