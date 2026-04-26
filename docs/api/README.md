# Traivo One — API-dokumentation

*Senast uppdaterad: 2026-04-26*

Detta är index över all API- och integrationsdokumentation som rör
Traivo One (backend) och Traivo Go (mobilappen). Alla dokument är
skrivna på svenska och bör läsas i den ordning som föreslås nedan.

---

## Börja här

| Fil | Vem | Innehåll |
|-----|-----|----------|
| [`TRAIVO_GO_PROMPT.md`](TRAIVO_GO_PROMPT.md) | Den som bygger Traivo Go från noll | Översikt, tech-stack, fullständig endpoint-lista, designprinciper |
| [`TRAIVO_API_CONTRACTS.md`](TRAIVO_API_CONTRACTS.md) | Båda team | Kärndatamodeller, statusflöden, WebSocket-event, prismodell, sync-batchformat, driver-notifikationstyper |
| [`TRAIVO_GO_INTEGRATION_GUIDE.md`](TRAIVO_GO_INTEGRATION_GUIDE.md) | Den som integrerar Traivo Go | Detaljerad integrationsguide — auth, alla `/api/mobile/*`-endpoints, exempel |
| [`MOBILE_API.md`](MOBILE_API.md) | Snabb-referens | Kort översikt över mobil-API:et med pekare till de djupa dokumenten |

## Sprintdokument (kronologiskt, nyast först)

| Fil | Datum | Sprint / task |
|-----|-------|---------------|
| [`TRAIVO_GO_SCHEMA_PUBLISHING_INTEGRATION.md`](TRAIVO_GO_SCHEMA_PUBLISHING_INTEGRATION.md) | 2026-04-26 | Schemautskick + extrajobb-SMS (task #264) |
| [`TRAIVO_GO_AKUT_JOBB_INTEGRATION.md`](TRAIVO_GO_AKUT_JOBB_INTEGRATION.md) | 2026-03-27 | Akut jobbhantering |
| [`TRAIVO_GO_INTEGRATION_R1-R6.md`](TRAIVO_GO_INTEGRATION_R1-R6.md) | 2026-03-25 (uppd. 2026-04-26) | Ruttoptimerings-sprint R1–R6 |
| [`TRAIVO_GO_SYNC_INSTRUCTIONS.md`](TRAIVO_GO_SYNC_INSTRUCTIONS.md) | (klient-sida, oförändrat) | Att-göra-lista + dagsrapport i appen |

---

## Backend-fakta (för referens)

- **Endpoints totalt:** ~995
- **Mobil-endpoints:** 94 (`/api/mobile/*`)
- **Databastabeller:** 138
- **Auth (mobil):** Opaque bearer-token (`Authorization: Bearer <token>`)
  från `POST /api/mobile/login`. In-memory token-store, 24h TTL — inte
  en JWT. Inga andra header-varianter (t.ex. `x-mobile-token`) stöds av
  middleware.
- **Versionering:** Alla endpoints fungerar både som `/api/...` och
  `/api/v1/...`. Nya klienter ska använda `/api/v1/`. Den oprefixade
  varianten svarar fortfarande men returnerar `Deprecation`- och
  `Sunset`-headers (`Sunset: 2027-06-01`).

---

## Konventioner i dokumentationen

- **Språk:** Svenska genomgående. Endast tekniska enum-värden, fältnamn
  och kodexempel är på engelska.
- **Tidsstämplar:** ISO 8601 (`2026-04-26T13:32:00.000Z`).
- **Datum (utan tid):** `YYYY-MM-DD` (t.ex. `lastSchedulePeriodStart`).
- **Belopp:** Alltid i öre (1/100 SEK) för internt bruk; UI delar med 100.
- **Tenant-isolering:** Alla entiteter har `tenantId`. Alla endpoints
  verifierar tenant-tillhörighet.

---

## Vid frågor

Backend-källfiler för respektive flöde:

| Område | Källfiler |
|--------|-----------|
| Mobil-auth | `server/routes/mobile/auth.ts` |
| Mobil-preferenser | `server/routes/mobile/preferences.ts` |
| Mobil-notiser | `server/routes/mobile/misc.ts` |
| Schemautskick | `server/customer-notifications.ts` |
| Extrajobb-SMS | `server/extra-job-sms.ts` |
| Akut-jobb | `server/routes/urgent-jobs.ts` |
| Resurser (admin) | `server/routes/resourceRoutes.ts` |
| WebSocket | `server/websocket.ts` |
