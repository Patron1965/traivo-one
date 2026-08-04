# Tenant-isolering — principer och garantier

Traivo är multi-tenant SaaS: en Postgres-databas, en Express-app, många organisationer
(tenants). Isoleringen är applikationslagrets ansvar (ingen RLS i Postgres idag).
Detta dokument samlar principerna så att isoleringen är en plattformsgaranti —
inte något varje route måste komma ihåg på egen hand.

Verifieras löpande av `tests/api/cross-tenant-isolation.test.ts` (bred attack-svit)
samt de riktade sviterna `object-endpoints-tenant-isolation.test.ts`,
`notifications-tenant-isolation.test.ts`, `admin-route-tenant-guard.test.ts`,
`portal-scope-isolation*.test.ts` och `tenant-ownership.test.ts`.

## 1. Tenant-resolution — fyra ytor

| Yta | Kontextkälla | Middleware | Tenant-fält på request |
| --- | --- | --- | --- |
| Web-API (`/api/*`) | Inloggad användare → `user_tenant_roles` | `requireTenantWithFallback` (`server/tenant-middleware.ts`) | `req.tenantId`, `req.tenantRole` |
| Mobil (`/api/mobile/*`) | Bearer-token → resurs | `isMobileAuthenticated` | `req.mobileTenantId` (+ `req.mobileResourceId`) |
| Kundportal (`/api/portal/*`) | Portal-session (Bearer) | `requirePortalAuth` | sessionens `tenantId` + `customerId` + objekt-scope |
| Publikt (`/api/public/*`) | QR-kod / HMAC-signerad token | ingen global mw — resolvas per resurs | härlett från DB-raden bakom koden/token |

Regler:

- **Web:** läs alltid tenant via `getTenantIdWithFallback(req)`. I produktion kastar
  den om middleware saknas; i dev faller den tillbaka på `kinab` med varning. Lita
  aldrig på klient-skickad tenant (header/body/query). Det enda undantaget är den
  interna batch-bypassen (`x-internal-admin-token` matchad mot
  `INTERNAL_ADMIN_TOKEN` + `x-tenant-id`) för schemalagda jobb.
- **Mobil:** `/api/mobile/*` går utanför den globala tenant-middlewaren;
  `isMobileAuthenticated` sätter `req.mobileTenantId` (+ `req.mobileResourceId`)
  från Bearer-token. Använd `req.mobileTenantId` — inte `req.tenantId` (den är
  aldrig satt på mobilytan). `getTenantIdWithFallback` faller numera tillbaka på
  `req.mobileTenantId` när `req.tenantId` saknas, så äldre mobil-handlers som
  anropar hjälparen får rätt (token-härledd) tenant istället för dev-fallbacken.
- **Portal:** utöver tenant är sessionen kund-bunden. Mutationer på arbetsordrar
  måste även verifiera `order.customerId === session.customerId` (objekt-scope
  räcker inte — delade objekt ger annars IDOR).
- **Publikt:** rå tenant-slug får aldrig tas emot från klienten (enumeration).
  Tenant resolvas server-side via QR-kod eller HMAC-signerad token
  (`server/dynamic-qr-token.ts`).

## 2. Rollmodellen

- All access-kontroll använder **tenant-rollen** (`user_tenant_roles.role`:
  owner/admin/planner/user), som middlewaren sätter på `req.tenantRole`.
  `users.role` är legacy och används inte för behörighet.
- `requireAdmin` kräver `owner`/`admin` och förutsätter att tenant-middlewaren
  körts (mönstret `requireTenant → requireAdmin`). `/api/admin/*`-routes som
  avviker måste stå i allow-listan i `tests/api/admin-route-tenant-guard.test.ts`
  med motivering.
- Behörighetsbeslut härleds server-side (t.ex. `req.tenantRole`) — aldrig från
  klient-payload.

## 3. Query-konventioner (defense-in-depth)

1. **Varje WHERE har tenant-predikat** — även UPDATE/DELETE/COUNT, och även när
   en pre-check redan verifierat ägarskap. Ett saknat predikat i en mutation är
   ett hål även om läs-vägen är skyddad.
2. **By-id-läsningar verifieras med `verifyTenantOwnership(resource, tenantId)`**
   (`server/routes/helpers.ts`) och svarar **404** (aldrig 403) vid fel tenant —
   existensen av en annan tenants resurs får inte läcka.
3. **Joins & subqueries tenant-filtreras på varje led** — inte bara på huvudtabellen.
   (Korrelerade subqueries i rå SQL: kvalificera kolumnerna, se memory
   `drizzle-correlated-subquery-column-qualification.md`.)
4. **Klient-skickade id-listor valideras mot tenant** innan de används
   (`verifyTenantOwnership`-mönstret för varje id, eller `WHERE tenant_id = …
   AND id IN (…)`).
5. **Soft-delete:** aktiva listningar filtrerar `deleted_at IS NULL`; arkiv/restore
   är `requireAdmin`.
6. **Storage-lagret är inte automatiskt säkert:** vissa `storage.get*(id)`-metoder
   tar inget tenant-argument — anroparen ansvarar för `verifyTenantOwnership`.
   Nya storage-metoder bör ta `tenantId` och lägga predikatet i queryn.

## 4. Kända fällor (från tidigare incidenter)

- **UPDATE utan tenant i WHERE** trots pre-check — lades till som obligatorisk
  konvention efter fynd i mutationsvägar (memory `multi-tenant-update-predicates.md`).
- **Portal: objekt-scope utan kund-bindning** — delade objekt gav IDOR på
  WO-mutationer (memory `portal-order-auth-customer-binding.md`).
- **SPA-shadowing:** `/objects/<id>` måste falla till SPA via `next("route")`
  före auth-middleware, annars 401 från fel route (memory
  `objects-route-spa-shadowing.md`).
- **Join-läckor på objektsidans endpoints** — koncept-/kundnamn från annan tenant
  läckte via join utan tenant-predikat (fixat, vaktas av
  `object-endpoints-tenant-isolation.test.ts`).
- **Cross-tenant-referenser i writes:** fält som pekar på andra rader
  (resourceId, articleId, parentId, ersättningsartikel …) måste tenant-verifieras,
  inte bara huvudresursen.

## 5. Framtida riktning (ej beslutat)

- **Postgres RLS** med `current_setting('app.tenant_id')` skulle flytta garantin
  till DB-lagret; kräver att alla anslutningar sätter kontexten och en
  migreringsplan för 190+ tabeller.
- **Automatisk query-scoping i ORM-lagret** (tenant-medveten wrapper runt drizzle)
  är ett mindre steg med liknande effekt.

Båda dokumenteras här som riktning — dagens garanti är konventionerna ovan plus
attack-testsviten.
