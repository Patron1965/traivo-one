---
name: API-tester körs mot dev-servern
description: Krav och fällor när vitest-API-tester slår mot den riktiga servern på :5000
---

- API-integrationstesterna (tests/api/*) slår mot den riktiga dev-servern på port 5000 — workflow "Start application" (`ENABLE_REALTIME_TEST_ROUTES=true npm run dev`) måste vara igång, annars massiv ECONNREFUSED.
- Rate-limiters (server/middleware/rate-limit.ts) skippas när `ENABLE_REALTIME_TEST_ROUTES==="true"` (aldrig i prod). Utan detta ger upprepade testkörningar 429 (authLimiter 20/15min). Serveromstart krävs efter ändring.
- Mobil-login kräver att resursen har konfigurerad PIN som matchar (auth-bypass-fix). Seed lämnar vissa demo-resurser utan PIN → 401. `ensureMobilePinFixture` i tests/api/socket-io-helpers.ts sätter test-PIN på PIN-lösa aktiva resurser före login.
- Team-invite är väntande (acceptedAt=null): live-join i socketrummet + syntetisk team:order_updated sker först vid accept, inte vid invite.
- Objektets kund kopplas via Ekonomi-metadatafältet "Kund" (`ensurePrimaryPayer` i server/services/object-customer.ts) — `storage.createObject` ignorerar customerId; testfixturer som behöver härledd kund (t.ex. IoT-auto-order, work_orders.customer_id NOT NULL) måste kalla den explicit.
- Isolerade express-testappar måste montera errorHandler (AppError-migrationen): routes kastar AppError i stället för att svara direkt.
