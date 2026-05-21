---
title: Traivo Go ↔ Traivo One kompatibilitet
---
# Traivo Go ↔ Traivo One kompatibilitet

## What & Why
Traivo One (Kinab-pilot) är publicerad med ny prod-konfig: magic-link-inloggning för admins, auto-tilldelning av tenant AV i prod, ny v2-orderdetalj med frozen-prislås + BOM-checklista, ny degraded-mode-banner, samt nya WebSocket-events för optimering och SLA-risk. Traivo Go-repot (`Patron1965/traivo-go`) pekar fortfarande mot legacy-env-vars (`PLANNIX_API_URL`/`KINAB_API_URL`), bär kvar "Plannix"-branding på flera ytor, missar v2-fält som behövs för att fältarbetaren ska se varför en order är blockerad, och saknar feedback när tjänster är degraderade. Mock-läget kan dessutom oavsiktligt slås på i prod om env-vars saknas.

Det här uppdraget gör Traivo Go redo för Kinab-piloten genom att rikta proxyn rätt, hårda säkerheten, konsumera nya v1-endpoints och visa de nya statusvärdena tydligt för föraren.

## Done looks like
- Fältarbetare loggar in i Traivo Go mot prod-Traivo-One utan extra konfig (rätt domän per env, ingen risk att mock slås på i prod).
- Orderdetalj visar "Kan inte starta — väntar på order X" när Traivo Ones v2-endpoint säger att ordern är blockerad, och en låst-pris-märkning när snapshot finns.
- En gul varningsbanner visas högst upp när Traivo Ones integrations-health rapporterar degradering (t.ex. Geoapify nere).
- Vid app-start visas tydligt fel om backend är otillgänglig (`/healthz` 503) i stället för en hängande splash-screen.
- Inloggning som inte är kopplad till en tenant ger ett begripligt felmeddelande på svenska i stället för en generisk 401.
- Inga "Plannix"-strängar, plannix-logos eller `plannix-demo`-tenant kvar i UI, bundlar eller mocks. Befintliga AsyncStorage-nycklar är oförändrade så installerade telefoner inte loggas ut.
- WS-anslutningen hanterar `optimization_complete`, `optimization_failed`, `route_optimized` (toast) och `sla_risk_critical` (SLA-banner på hem).
- Smoke-test mot prod genomfört: login → my-orders → status-flow → v2-orderdetalj → WS-handshake → push-token register/unregister.

## Out of scope
- Ingen ändring av Traivo One-backenden (alla endpoints som behövs finns redan).
- Ingen ändring av AsyncStorage-nyckelnamn (skulle radera inloggade fältarbetare vid uppgradering).
- Ingen ny native-funktionalitet (inga nya Expo-plugins, ingen ny scheme-byte i pågående TestFlight-bygge — scheme/bundleId-byte sker i nästa större release).
- Ingen ändring av PIN-login-flödet (oförändrat).
- Ingen ny offline-sync-logik.

## Steps
1. **Riktad proxy + prod-säker mock** — Inför `TRAIVO_API_URL` som primär env-variabel i proxy-laget, behåll `PLANNIX_API_URL`/`KINAB_API_URL` som fallback under en övergångsperiod, och säkerställ att mock-läget aldrig kan aktiveras när `NODE_ENV=production`. Höj proxy-timeout till 30s för routing- och sync-endpoints så VRP-jobb hinner svara.
2. **Brand-rensning utan att tappa state** — Byt ut "Plannix"-strängar, logotyper och mock-tenant `plannix-demo` mot Traivo-motsvarigheter i UI, mocks, replit.md och förbyggda `server/static-bundles/`. AsyncStorage-nycklar (`auth`, `@driver_online_status`, `@last_activity_timestamp`, `@resource_profiles`, `driver_core_settings`, `@driver_start_position`) lämnas exakt som de är.
3. **Inloggningsfel-meddelanden för prod** — Översätt 401 från Traivo One ("ingen tenant-tilldelning") till ett begripligt svenskt fel i LoginScreen ("Ditt konto är inte kopplat till någon organisation. Kontakta din administratör."). Säkerställ att `impossible`-status alltid skickas med `impossibleReason` för att undvika 400 från backend.
4. **v2-orderdetalj** — Växla OrderDetailScreen till `GET /api/mobile/v2/orders/:id` och rendera `frozen` (låst-pris-märkning), `bomChecklist` (kontrollerbara komponenter) och `canStart`/`blockedBy` (visa "Väntar på order X" och inaktivera Starta-arbete-knappen när blockerad). Fält dokumenterade i Traivo Ones `docs/traivo-go-v2-handover.md`.
5. **Degraded-mode-banner + healthz-gate** — Pollla `GET /api/v1/system/integrations/health` var 60:e sekund och visa en gul banner högst upp när någon critical-integration är degraderad, med expanderbara detaljer per tjänst. Vid app-start anropas `GET /healthz` — om 503 visas "Servern är otillgänglig, försök igen om en stund" innan login-skärmen.
6. **Nya WS-events** — Lägg till hanterare i `useWebSocket` för `optimization_complete`, `optimization_failed`, `route_optimized` (toast med "Din rutt har uppdaterats — dra ner för att läsa om") och `sla_risk_critical` (visar SLA-banner på HomeScreen tills föraren bekräftat).
7. **Proxy-loggning utan secrets** — Säkerställ att `Authorization`-headers och request-bodies aldrig hamnar i `[PROXY]`-loggarna. Endast `METHOD path → status` får loggas.
8. **Smoke-test mot prod-Traivo-One** — Kör en checklista: login → `/api/mobile/me` → `/api/v1/mobile/my-orders?date=...` → status-flow (dispatched → en_route → in_progress → utford) → `/api/v1/mobile/v2/orders/:id` → WS-handshake → push-token POST + DELETE. Dokumentera resultaten i en kort rapport.

## Relevant files
- `server/routes/mobile/proxyHelper.ts`
- `server/routes/mobile/auth.ts`
- `client/lib/query-client.ts`
- `client/context/AuthContext.tsx`
- `client/screens/LoginScreen.tsx`
- `client/screens/OrderDetailScreen.tsx`
- `client/screens/HomeScreen.tsx`
- `client/hooks/useWebSocket.ts`
- `client/hooks/useNotifications.ts`
- `app.json`
- `replit.md`
- `server/static-bundles/`