---
name: Service worker + per-tenant config endpoints
description: SW cache och konfig-endpoints (branding, terminologi, me, auth) ska aldrig blandas.
---

Service workern i `client/public/sw.js` intercepterar alla `/api/*`-requests. Endpoints som returnerar mutable per-tenant config måste explicit bypassas (lägg till prefix i `ALWAYS_BYPASS_PREFIXES`) — annars riskerar man att en gammal cachad respons, eller bara felaktigt SW-tagande av requesten, döljer ändringar långt efter logout/login.

**Why:** Användare rapporterade att branding-ändringar inte syntes ens efter logout/login. SW:n hade `unicorn-api-v1` cache med gamla entries från tidigare versioner, och även för "non-cacheable" routes gick requesten genom SW:ns fetch-handler vilket kunde dölja bugfixar i HTTP-cache-headers. Att tömma SW manuellt (clear-cache.html) är inte en användarflow vi kan kräva.

**How to apply:**
- Lägg till nya config-endpoints i `ALWAYS_BYPASS_PREFIXES` i `sw.js`. Bypass = `return` utan `respondWith`, så browsern hanterar requesten själv och respekterar `Cache-Control`.
- **Bumpa både `CACHE_NAME` och `API_CACHE_NAME`** vid varje SW-logik- eller bypass-liständring. `activate`-handlern raderar då alla cachar som inte matchar de nya namnen, och `skipWaiting + clients.claim` ger nya SW kontroll direkt.
- För endpoints som ska vara offline-tillgängliga (work-orders, customers, objects, resources, clusters) — använd `CACHEABLE_API_ROUTES`, aldrig för config.
