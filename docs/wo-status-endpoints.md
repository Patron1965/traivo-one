# Work-order-status-endpoints — beslutsmatris (Task #451)

Fyra endpoints rör i praktiken work-order-tillstånd. Efter granskning behåller vi
alla fyra — de har olika ansvar och olika klienter. Sammanslagning bakom en
gemensam handler skulle bryta mobil-app-versioner och göra side-effects implicita.

| Endpoint | Klient | Validering | Skriver | Sidoeffekter | Beslut |
| --- | --- | --- | --- | --- | --- |
| `POST /api/work-orders/:id/status` | Web/admin | `ORDER_STATUSES` enum + `updateWorkOrderStatus` övergångsregler | `status` | (inga) | **Behåll.** Kanonisk admin-route. |
| `PATCH /api/mobile/orders/:id/status` | Mobil-app | Mobil-alias (`paborjad`, `utford`, `en_route`, `dispatched`, `impossible`, `ej_utford`, `cancelled`, …) | `orderStatus`, `executionStatus`, `onWayAt`, `onSiteAt`, `completedAt`, `impossibleAt`, `actualDuration`, `notes` | ETA-notification, `handleWorkOrderStatusChange`, signature-lookup, berikad payload | **Behåll.** Mobil-specifik – sammanslagning skulle kräva ny mobil-app. |
| `POST /api/field-worker/tasks/:id/complete` | Field-worker UI | (smal — id i path) | `status=completed`, `executionStatus=completed`, `completedAt` + cascade på `taskDependencyInstances.completed` | `handleWorkOrderStatusChange` | **Behåll.** Cascadar dependencies som ingen annan route gör. |
| `POST /api/mobile/status` | Mobil-app | `{ online: boolean }` | `resources.isOnline`, `lastSeenAt` | (inga) | **Behåll, men dokumentera.** Trots namnet rör denna *resurs* online/offline, ej WO-status. Namn behålls för bakåtkompatibilitet. |

## Vad som inte gjordes och varför

- **Ingen gemensam handler** för WO-status: skillnaderna i validering, sidoeffekter
  och respons-payload är så stora att en gemensam handler skulle behöva växel-logik
  per klient – samma kostnad som dagens duplicering, men svårare att läsa.
- **`/api/mobile/status` döps inte om** – publicerade mobil-app-versioner (`v1`,
  `v2`) anropar den. En refaktorering kräver mobil-app-release och deprecation-window.
- **`POST /api/field-worker/tasks/:id/complete`** kunde i teorin kalla
  `storage.updateWorkOrderStatus("completed")` istället för `updateWorkOrder({...})`,
  men dependency-cascade saknas där och passar bättre i field-worker-domänen.

## Inline-pekare

Varje endpoint har nu en kommentar i koden som pekar tillbaka till detta dokument
och beskriver varför den finns separat.
