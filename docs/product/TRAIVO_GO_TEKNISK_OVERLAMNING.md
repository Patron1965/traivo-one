# Traivo Go — teknisk överlämning

Detta dokument är en teknisk överlämning till mobilapp-projektet **Traivo Go** (den fristående chaufförsappen). Backend + webbapp kallas **Traivo One**. Fokus här är sådant som Go-teamet behöver veta om lagring, API-stabilitet, tenant-arkitektur och branding.

> Namn: plattformen heter **Traivo** (webb/backend = "Traivo One"), fält-appen heter **Traivo Go**. (Ett tidigare "Plannix"-namn är avfört och gäller inte.)

---

## 1. KRITISKT — identifierare som MÅSTE bevaras

Följande lagrings-nycklar och event-namn är **stabila identifierare**, inte varumärkestext. Byt dem aldrig (t.ex. vid en framtida logga-/namnändring) — då tappar befintliga fält-användare data:

| Identifierare | Var | Varför bevara |
|---|---|---|
| `traivo-offline-db` | IndexedDB-namn | Byter du namn skapas en ny tom DB → all offline-cache, osynkade foton och outbox-poster (osynkade statusuppdateringar från fält) försvinner |
| `traivo-language` | localStorage-nyckel | Användarens språkval återställs annars till default |
| `traivo-tours-seen` | localStorage-nyckel | Användare får annars se onboarding-turen igen |
| `traivo-focused-resource` | localStorage-nyckel | Fokuserad resurs nollställs annars |
| `traivo-resource-focus` | BroadcastChannel | Tab-synkning av fokus bryts annars |
| `traivo:optimization_complete` | CustomEvent-namn | Lyssnare i koden bryts annars |
| `@assets/traivo_logo_*.png` | Image import-paths | Ändra inte sökvägen, bara ev. `alt`-texten |

**Tumregel:** versalt "Traivo"/"TRAIVO" är användarsynlig text; lowercase `traivo` är ofta en stabil identifierare och ska inspekteras innan den rörs.

---

## 2. Backend-API — stabila kontrakt

- Alla `/api/*`-endpoints är stabila; mobilytan = `/api/mobile/*` (se `docs/traivo-go-api-match-report.md`).
- Webbens auth-flöde (Replit Auth) och mobilens **bearer-token**-flöde är åtskilda.
- WebSocket-events i `shared/ws-events.ts` har stabila event-namn.
- Databas-schemat och tenant-isolering via `tenant_id`-middleware är oförändrade kontrakt.

---

## 3. Tenant-arkitektur (gott att veta)

Traivo kör **delad databas + delat schema** med `tenant_id`-isolering. Det betyder för Traivo Go:

- En användare kan tillhöra **flera tenants** (`user_tenant_roles`-tabellen).
- Aktivt `tenant_id` måste hanteras vid varje API-anrop.
- Branding (färger, logo, företagsnamn) hämtas per tenant via `/api/tenant-branding` — använd det istället för hårdkodade färger om appen ska vara white-label.
- Offline-cachen är **inte** tenant-separerad i nuvarande design. Om en fält-användare byter tenant medan offline kan det ge förvirrad data — något att tänka på inför multi-tenant fält-användare.

---

## 4. Skalbarhet — vad backend planerar

Åtgärdas när vi närmar oss ~10 kunder:

- Explicit databas-connection-pool.
- Tenant-medvetna bakgrundsjobb (anomali-övervakning, veckorapporter).
- Självbetjänings-onboarding för nya tenants.

Traivo Go behöver inte göra något inför detta, men håll koll på:

- WebSocket-anslutningar kan flyttas bakom Redis pub/sub vid horisontell skalning — reconnect-logik bör vara robust.
- Bakgrundsjobb kan flyttas till en jobbkö — latency-känsliga endpoints (t.ex. "skapa rapport") kan komma att returnera `202 Accepted` med polling istället för synkront svar.

---

## 5. Branding-tillgångar

- Logo-bilderna heter `traivo_logo_*.png` och används som utgångspunkt tills en egen "Traivo Go"-logga tas fram.
- Färgschema (Traivo-paletten): Deep Ocean Blue `#1B4B6B`, Northern Teal `#4A9B9B`, Aurora Green `#7DBFB0`, Arctic Ice `#E8F4F8`, Mountain Gray `#6B7C8C`, Midnight Navy `#2C3E50`.
- Typsnitt: **Inter**.
- Se `docs/traivo-go-anpassningsrapport.md` §13 för design-/layout-paritet (statusfärger, tema-tokens, mörkt läge).
