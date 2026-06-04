---
name: /objects route — SPA vs object-storage shadowing
description: Varför /objects/<id> kan logga ut användaren och hur middleware-ordningen måste hanteras
---

# `/objects/*` — SPA-route skuggas av object-storage-serving

Object-storage-integrationen registrerar `GET /objects/:objectPath(*)` (server/replit_integrations/object_storage/routes.ts) för att servera privata uppladdade filer. SPA:n har samtidigt en klient-route `/objects/:id` (objekt-detaljsidan). De delar prefix `/objects/`, så server-routen skuggar SPA-routen vid full sidladdning/SW-hämtning.

## Regel (durabel)
Single-segment `/objects/<id>` (utan `/`) MÅSTE falla igenom till SPA:n. Bypass-kontrollen måste köra FÖRE auth-middlewaren och använda `next("route")` — inte `next()`.

**Why:** Om `isAuthenticated`/`requireTenantWithFallback` ligger före bypass-checken returnerar de rå `401 {"message":"Unauthorized"}` för `/objects/<id>` så snart sessionen inte är giltig på just den requesten. Klienten/SW tolkar det 401-svaret som utloggning → användaren "loggas ut" när hen öppnar "Öppna fullständig vy". `next()` räcker inte eftersom det stannar kvar i samma route-stack och fortfarande kör auth; `next("route")` hoppar hela storage-handlern och låter SPA-catch-all serva index.html oavsett auth-status.

**How to apply:** Lägg gate-handlern (`if (!objectPath.includes("/")) return next("route")`) som FÖRSTA handler på `app.get("/objects/:objectPath(*)", ...)`, före `isAuthenticated`. Multi-segment riktiga objektvägar (`/objects/uploads/<uuid>`) ska fortsatt köra `isAuthenticated` + `requireTenantWithFallback` + `canAccessObjectEntity` (ACL). Bryt aldrig den enforcement för multi-segment.
