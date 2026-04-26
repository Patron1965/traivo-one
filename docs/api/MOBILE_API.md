# Traivo One — Mobil-API (kort referens)

*Senast uppdaterad: 2026-04-26*

> **Detta dokument är en kortreferens.** Den fullständiga datamodellen och
> kontrakten lever i `TRAIVO_API_CONTRACTS.md`. Integrationsguiden för
> Traivo Go-mobilappen ligger i `TRAIVO_GO_INTEGRATION_GUIDE.md`. Börja
> där om du integrerar mobilappen från grunden.
>
> Denna fil ersätter den tidigare "Unicorn Fältapp"-dokumentationen.
> All information som var unik här (foto-upload, beroendekedjor,
> inspektion) har migrerats in i `TRAIVO_API_CONTRACTS.md` och
> sprintdokumenten under `docs/api/TRAIVO_GO_*`.

---

## 1. Autentisering — Bearer-token i header

Mobilappen skickar inga cookies. Alla `/api/mobile/*`-endpoints kräver
en opaque bearer-token (genererad av `POST /api/mobile/login`) i
`Authorization`-headern:

```
Authorization: Bearer <mobile-token>
```

Token är en opaque sträng (slumpmässig hex), inte en JWT. Den valideras
mot en in-memory token-store på servern (`mobileTokens` i
`server/routes/helpers.ts`) och har 24 timmars TTL. Vid 401: rensa
token och visa inloggningsskärmen.

### POST /api/mobile/login

```json
{ "email": "anna@kinab.se", "pin": "1234" }
```

Alternativ inloggning: `{ "username": "anna", "password": "1234" }` eller
endast `{ "pin": "1234" }` om PIN är unik per tenant.

**Response (200):**

```json
{
  "token": "5e2a...hex",
  "user": { "id": "res-abc", "name": "Anna", "role": "driver", ... },
  "resource": { "id": "res-abc", "tenantId": "...", "smsOnScheduleSend": true, ... }
}
```

Token är giltig 24 timmar. Vid 401 från en endpoint: rensa token, visa
inloggningsskärmen.

### POST /api/mobile/logout

Auth: bearer-token. Invalidates the token. Response: `{ "success": true }`.

### GET /api/mobile/me

Returnerar inloggad resurs (alla fält från `resources`-tabellen,
inklusive de nya publicerings-/SMS-fälten — se
`TRAIVO_GO_SCHEMA_PUBLISHING_INTEGRATION.md`).

---

## 2. API-versionering

Alla mobil-endpoints är tillgängliga både utan prefix (`/api/mobile/...`)
och med versions-prefix (`/api/v1/mobile/...`). Nya klienter ska
använda `/api/v1/`. Det oprefixade alternativet skickar
`Deprecation: true` och `Sunset: 2027-06-01` i response-headers.

Versions-discovery: `GET /api/version` →
`{ "current": "v1", "supported": ["v1"] }`.

---

## 3. Endpoint-översikt (förkortad)

För fullständig lista — inklusive payload, statusövergångar och felkoder —
se `TRAIVO_GO_INTEGRATION_GUIDE.md` §3 och `TRAIVO_API_CONTRACTS.md`.

| Område | Endpoints |
|--------|-----------|
| Auth | `POST /api/mobile/login`, `POST /api/mobile/logout`, `GET /api/mobile/me` |
| Profil | `GET/PUT/PATCH /api/mobile/preferences`, `PATCH /api/mobile/me/notification-prefs` |
| Ordrar | `GET /api/mobile/my-orders`, `GET /api/mobile/orders/:id`, `PATCH /api/mobile/orders/:id/status` |
| Rapportering | `POST /api/mobile/orders/:id/notes`, `/photos`, `/deviations`, `/materials`, `/signature`, `/inspections` |
| Sync | `POST /api/mobile/sync`, `GET /api/mobile/sync/status` |
| GPS | `POST /api/mobile/position`, `POST /api/mobile/gps` |
| Arbetspass | `/api/mobile/work-sessions/start|stop|pause|resume|active|:id/entries` |
| AI | `POST /api/mobile/ai/chat|transcribe|analyze-image` |
| Notiser | `GET /api/mobile/notifications`, `PATCH .../read`, `PATCH .../read-all`, `GET .../count` |
| Akut | `POST /api/mobile/jobs/urgent/accept|decline`, `POST .../:id/status`, `GET .../active` |
| Övrigt | `GET /api/mobile/summary`, `/weather`, `/articles`, `/terminology`, `/route-feedback/*` |

---

## 4. Vidare läsning

| Dokument | Innehåll |
|----------|----------|
| `TRAIVO_GO_INTEGRATION_GUIDE.md` | Komplett integrationsguide för mobilappen — auth, WebSocket, alla endpoints, feature flags, statushantering. |
| `TRAIVO_API_CONTRACTS.md` | Datamodell, statusflöden, WebSocket-eventkatalog, prismodell, sync-batchformat. |
| `TRAIVO_GO_SCHEMA_PUBLISHING_INTEGRATION.md` | Schemautskick + extrajobb-SMS (task #264). |
| `TRAIVO_GO_AKUT_JOBB_INTEGRATION.md` | Akut jobbhantering (urgent jobs). |
| `TRAIVO_GO_INTEGRATION_R1-R6.md` | Ruttoptimerings-sprinten R1–R6 (Geoapify, disruption, raster, kund-ETA). |
| `TRAIVO_GO_PROMPT.md` | Översikt och tech-stack för mobilappen. |
| `TRAIVO_GO_SYNC_INSTRUCTIONS.md` | Att-göra-lista + dagsrapport-funktioner i mobilappen. |
| `README.md` | Indexet — börja här. |
