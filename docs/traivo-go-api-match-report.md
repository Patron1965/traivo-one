# Traivo Go ↔ Traivo One — API-matchningsrapport

> Källa till sanning för backendytan är Traivo One:s faktiska mobil-routes i
> `server/routes/mobile/*`. Rapporten bevakas av
> `pnpm run check:traivo-go-api-match`.

## 1. Sammanfattning

- **De åtta dokumenterade avvikelserna är stängda (8/8).**
- Go använder nu Ones befintliga operationer; inga kompatibilitetsalias eller
  nya mobilroutes har lagts till för att dölja skillnader.
- Versionshanteringen är oförändrad och verifierad. Go skriver om
  `/api/mobile/X` till `/api/v1/mobile/X`; One strippar `/api/v1` och routar
  internt till `/api/mobile/X`.
- Go-klienten genereras från en verifierad OpenAPI-extraktion som korsas mot
  Ones routeinventering. Kända stand-ins genereras inte.

**Verdikt:** de åtta avvikelser som tidigare gav cirka 90 procents
överensstämmelse är lösta. Den rapporterade API-ytan matchar nu 100 procent.

## 2. Lösta avvikelser

| # | Tidigare Go-anrop | Slutlig lösning |
|---|---|---|
| 1 | `GET /api/mobile/app/config` | Go använder `GET /api/mobile/app-config`. |
| 2 | `GET/PATCH /api/mobile/user/preferences` | Go använder `GET/PATCH /api/mobile/preferences` och läser `data.preferences`. |
| 3 | `GET /api/mobile/notifications/unread-count` | Go använder `GET /api/mobile/notifications/count` och läser `data.unreadCount`. |
| 4 | `POST /api/mobile/position/batch` | Go skickar buffrade positioner en och en till `POST /api/mobile/position`. |
| 5 | Async `POST /api/mobile/optimize-route` + polling | Async-stand-in och polling är borttagna. Ones synkrona `GET /api/mobile/route-optimized` är den kontrakterade optimeringsoperationen. |
| 6 | `POST /api/mobile/ai/voice-command` | Go använder `POST /api/mobile/ai/transcribe`. |
| 7 | `POST /api/mobile/ai/chat/stream` | Go använder `POST /api/mobile/ai/chat`. |
| 8 | `GET /api/mobile/route-metrics/today` | Go använder `GET /api/mobile/statistics`. |

## 3. Verifierade ersättningsoperationer i One

Följande backendoperationer måste finnas för att de åtta lösningarna ska bestå:

- `GET /api/mobile/app-config`
- `GET /api/mobile/preferences`
- `PATCH /api/mobile/preferences`
- `GET /api/mobile/notifications/count`
- `POST /api/mobile/position`
- `GET /api/mobile/route-optimized`
- `POST /api/mobile/ai/transcribe`
- `POST /api/mobile/ai/chat`
- `GET /api/mobile/statistics`

Kontrollen körs med:

```sh
pnpm run check:traivo-go-api-match
```

Den failar om någon ersättningsoperation eller Ones `/api/v1`-hantering
försvinner. Go-repot har den kompletterande kontrollen som även stoppar
återintroduktion av de åtta gamla anropsvägarna och verifierar den genererade
klienten.

## 4. Rör inte versionsflödet

Bearer-token skickas till `/api/v1/mobile/*`. One härleder tenant från den
inloggade resursen. Klienten ska inte skicka tenant-id, och versionsomskrivningen
ska inte tas bort eller dubbleras.

## 5. Separata framtida kontrakt

Den här rapporten gäller de åtta uttryckligen dokumenterade
API-matchavvikelserna. Senare stopp-, editor- och partial-completion-funktioner
som ännu saknar verifierade One-routes eller scheman ska fortsätta vara
blockerade i Go och får inte blandas ihop med denna 8/8-verifiering.