# Traivo Go ↔ Traivo One — API-matchningsrapport

> Syfte: gör så att mobilappen **Traivo Go** (GitHub: `Patron1965/traivo-go`) och backenden **Traivo One** matchar varandra till 100 %.
> Källa till sanning = Traivo One:s faktiska mobil-routes (`server/routes/mobile/*` + `server/routes/urgentJobRoutes.ts`).
> Analyserad app-commit: `main` (rebrandad till "Plannix" i UI, men anropar fortfarande `/api/mobile/*`).

---

## 1. Sammanfattning

- **Versionshanteringen fungerar redan.** Appen skriver om alla anrop `/api/mobile/X` → `/api/v1/mobile/X` (`client/lib/query-client.ts` → `toV1Path`). Backenden tar emot `/api/v1/...`, strippar `/api/v1` och routar internt till `/api/mobile/...` (`server/routes.ts`, `API_VERSION = "v1"`). **Ändra ingenting här** — det matchar.
- **Autentiseringen matchar.** `login`, `logout`, `me`, `push-token` (POST/DELETE), `status`, `my-profiles` finns på båda sidor med Bearer-token.
- **Merparten av ytan matchar** (ordrar, sync, arbetspass, team, AI-chat/transkribering, väder, aviseringar, störnings-triggers, akutjobb m.m.).
- **8 konkreta avvikelser** kvarstår (avsnitt 3). 3 är rena namnbyten (enkel fix i appen), 5 kräver ett beslut (lägg till i backend **eller** peka om appen).

**Verdikt:** systemen är ~90 % i synk. Fixa de 8 punkterna nedan för 100 %.

---

## 2. Vad som redan matchar (rör ej)

| Område | App anropar | Traivo One har |
|---|---|---|
| Inloggning | `POST /api/mobile/login`, `POST /api/mobile/logout`, `GET /api/mobile/me` | ✅ |
| Push & status | `POST/DELETE /api/mobile/push-token`, `POST /api/mobile/status`, `GET /api/mobile/my-profiles` | ✅ |
| WS-token | `GET /api/v1/mobile/notifications/token` | ✅ `/api/mobile/notifications/token` |
| Ordrar | `my-orders`, `orders/:id`, `PATCH orders/:id/status`, `v2/orders/:id` | ✅ |
| Offline-sync | `POST /api/mobile/sync`, `GET /api/mobile/sync/status` | ✅ |
| Arbetspass | `work-sessions/active`, `work-sessions/start`, `…/stop|pause|resume|entries` | ✅ |
| Störnings-triggers | `POST /api/mobile/disruptions/trigger/{delay,early-completion,resource-unavailable}` | ✅ |
| Akutjobb | `POST /api/mobile/jobs/urgent/accept`, `…/decline`, `GET …/active` | ✅ (mountas via `app.use("/api", router)` i `urgentJobRoutes.ts`) |
| AI | `POST /api/mobile/ai/chat`, `…/ai/transcribe`, `…/ai/analyze-image` | ✅ |
| Team | `my-team`, `team-invites`, `team-orders`, `teams`, `teams/:id/{invite,leave,accept}` | ✅ |
| Aviseringar | `GET notifications`, `POST notifications/:id/read`, `POST notifications/read-all` | ✅ |
| GPS (enstaka) | `POST /api/mobile/position` | ✅ |
| Övrigt | `weather`, `distance`, `articles`, `break-config`, `route`, `route-feedback`, `deviations/mine`, `customer-change-requests*`, `work-orders/carry-over`, `time-summary` | ✅ |

---

## 3. Avvikelser att åtgärda (de 8)

### Kategori A — rena namnbyten (fixa i appen, enradare)

| # | Appen anropar | Traivo One har | Åtgärd i appen | Fil |
|---|---|---|---|---|
| 1 | `GET /api/mobile/app/config` | `GET /api/mobile/app-config` | byt `app/config` → `app-config` | `client/hooks/useAppConfig.ts` |
| 2 | `GET` + `PATCH /api/mobile/user/preferences` | `GET` / `PUT` / `PATCH /api/mobile/preferences` | byt `user/preferences` → `preferences` (3 ställen) | `client/hooks/usePreferences.ts` |
| 3 | `GET /api/mobile/notifications/unread-count` | `GET /api/mobile/notifications/count` | byt sökväg (2 ställen, inkl. `queryKey`) | `client/hooks/useNotifications.ts` |

**Svarsformer att matcha för kategori A:**
- **#2 preferences:** backend svarar inkapslat: `{ "preferences": { darkMode, fontSize, … } }` (inte ett platt objekt). Läs `data.preferences`. Tillåtna fält i PATCH: `darkMode` (bool), `fontSize` (enum), `pushCategories` (objekt) m.fl.
- **#3 count:** backend svarar `{ "unreadCount": number }`. Appen läser idag sannolikt `count`/`unreadCount` — säkerställ `data.unreadCount`.

### Kategori B — saknas i backend (kräver beslut: bygg i Traivo One *eller* peka om appen)

| # | Appen anropar | Läge i Traivo One | Rekommendation |
|---|---|---|---|
| 4 | `POST /api/mobile/position/batch` (`{ positions: [...] }`) | Ingen batch-route. Finns `POST /api/mobile/position` (enstaka) och `POST /api/mobile/gps`. | **Enklast:** ändra `client/hooks/useGpsTracking.ts` att skicka batchen via befintlig sync-kanal (`POST /api/mobile/sync` med `actionType: "gps"`) eller loopa `POST /api/mobile/position`. **Alt:** lägg till `POST /api/mobile/position/batch` i `server/routes/mobile/workSessions.ts`. |
| 5 | `POST /api/mobile/optimize-route` + `GET /api/mobile/optimize-route/:jobId/status` (async jobb + polling) | Backend har **synkron** `GET /api/mobile/route-optimized`. Inget jobb/status-mönster. | Synka mönstret. **Enklast:** ändra `client/hooks/useRouteOptimization.ts` till `GET /api/mobile/route-optimized` (synkront, ta bort pollingen). **Alt:** bygg async `optimize-route` + `…/status` i backend om kö önskas. |
| 6 | `POST /api/mobile/ai/voice-command` (`{ audio: base64 }`) | Saknas. Finns `POST /api/mobile/ai/transcribe` + `POST /api/mobile/ai/chat`. | `client/hooks/useVoiceCommands.ts` har redan `ai/transcribe` som fallback — låt transcribe vara primär, **eller** lägg till `ai/voice-command` i `server/routes/mobile/reporting.ts`. |
| 7 | `POST /api/mobile/ai/chat/stream` (streaming) | Endast `POST /api/mobile/ai/chat` (icke-streamande). | Falla tillbaka till `ai/chat` i appen, **eller** lägg till en SSE/stream-variant i backend. |
| 8 | `GET /api/mobile/route-metrics/today` | Saknas. Närmast: `route-feedback/mine`, `statistics/summary`, `route-optimized`. | Peka om appen till befintlig metrik-endpoint, **eller** lägg till `GET /api/mobile/route-metrics/today` i backend. |

---

## 4. Bonus: backend-endpoints appen *kan* anamma (valfritt)

Traivo One exponerar redan dessa mobil-routes som appen inte använder ännu — adoptera vid behov:
`GET /api/mobile/eta-notification/config` + `/history`, `GET /api/mobile/map-config`, `GET /api/mobile/terminology`, `GET /api/mobile/tasks/:id/metadata-context`, `POST /api/mobile/tasks/:id/metadata-update`, `GET /api/mobile/statistics` + `/statistics/summary`, `GET /api/mobile/orders/:id/materials` + `/time-entries`, `PATCH /api/mobile/orders/:id/substeps/:stepId`, `POST /api/mobile/work-orders/:id/auto-eta-sms`, `POST /api/mobile/travel-times`.

---

## 5. Checklista för 100 % match

- [ ] #1 `useAppConfig.ts`: `app/config` → `app-config`
- [ ] #2 `usePreferences.ts`: `user/preferences` → `preferences` (3 st) + läs `data.preferences`
- [ ] #3 `useNotifications.ts`: `notifications/unread-count` → `notifications/count` (2 st) + läs `data.unreadCount`
- [ ] #4 GPS-batch: använd `sync` (`actionType:"gps"`) eller loopa `position` — alternativt bygg `position/batch` i backend
- [ ] #5 Ruttoptimering: byt till synkron `route-optimized` — alternativt bygg async-jobb i backend
- [ ] #6 Röstkommando: använd `ai/transcribe` — alternativt bygg `ai/voice-command` i backend
- [ ] #7 AI-stream: falla till `ai/chat` — alternativt bygg stream-variant i backend
- [ ] #8 Ruttmetrik: peka om till befintlig metrik — alternativt bygg `route-metrics/today` i backend
- [ ] Rör **inte** versions-omskrivningen (`/api/v1/`-prefix) — den är redan korrekt

---

*Rapport genererad mot Traivo One:s faktiska route-definitioner. Vid framtida ändringar i `server/routes/mobile/*` — uppdatera denna lista så att båda systemen hålls i synk.*
