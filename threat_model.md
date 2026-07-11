# Threat Model

## Project Overview

Traivo is a multi-tenant field-service SaaS platform for planning, dispatch, customer portal access, mobile field work, reporting, and AI-assisted operations. The production stack is a React/TypeScript/Vite frontend backed by an Express/TypeScript API with PostgreSQL/Drizzle, Replit Auth web sessions, custom portal and mobile authentication flows, Replit Object Storage for uploaded media, and third-party integrations including OpenAI, Twilio, Resend, Fortnox, Geoapify, OSRM, and an optimization service.

Production security analysis should assume `NODE_ENV=production`, platform-managed TLS, and that mockup/dev sandbox surfaces are not deployed unless a path is proven production-reachable. For this deployment model, requests arrive through Replit-managed proxying on configured domains; arbitrary client-supplied `Host` header spoofing should not be treated as production-reachable unless a custom reverse-proxy path is introduced.

## Assets

- **Tenant business data** — work orders, customers, objects, invoices, schedules, route feedback, operational metrics, and AI/planning outputs. Cross-tenant disclosure or modification would materially impact customers.
- **User and operator identities** — Replit-authenticated web users, portal recipients, and mobile field workers. Compromise enables impersonation and unauthorized operational changes.
- **Uploaded media and documents** — photos, signatures, logos, field reports, and other object-storage-backed files. These may contain customer PII, location details, or proof-of-work artifacts.
- **Secrets and integration capabilities** — database credentials, session secrets, object-storage signing access, Twilio/Resend/Fortnox/OpenAI credentials, internal admin tokens, and scheduler/webhook secrets.
- **Availability-sensitive shared services** — route optimization, distance caching, notifications, and background schedulers. Abuse can create tenant-wide or platform-wide disruption and external API cost spikes.

## Trust Boundaries

- **Browser/mobile/portal client to Express API** — all request parameters, headers, cookies, and bearer tokens are untrusted until validated server-side.
- **Authenticated user to tenant-scoped data** — web users must be constrained to their assigned tenant and role on every API route.
- **Portal user to object-scoped data** — portal sessions may be scoped to a subset of a customer's objects via `portal_users` + `portal_user_object_scopes`. Every `/api/portal/*` route that returns or mutates object-bound resources (work orders, visit confirmations, ratings, chat, bookings, issue reports, field reports, delivery preferences, QR lookups) must enforce `isObjectInScope` against the resolved descendant set. Empty scope = full access (back-compat); a non-empty scope is a hard ceiling and must never be widened by client-supplied IDs.
- **Authenticated user to admin functions** — admin/owner capabilities are higher trust than normal tenant membership and must be enforced server-side on every privileged endpoint.
- **Portal/mobile/public routes to core application state** — `/api/portal/*`, `/api/mobile/*`, `/api/admin/*`, `/api/auth/*`, and storage/object-serving routes bypass the normal `/api` tenant middleware path and therefore require dedicated review.
- **API to PostgreSQL** — the server has broad data access; injection or missing tenant predicates can expose or corrupt all tenant data.
- **API to object storage** — the server can mint upload URLs and stream stored objects; missing ACL enforcement here directly exposes uploaded media.
- **API to third-party and internal services** — calls to OpenAI, Twilio, Resend, Fortnox, Geoapify, OSRM, and the optimization service cross trust boundaries and must not be driven by untrusted input without validation and authorization.

## Scan Anchors

- Production entry points: `server/index.ts`, `server/routes.ts`, route modules under `server/routes/**`.
- Highest-risk code areas: `server/tenant-middleware.ts`, `server/replit_integrations/auth/**`, `server/portal-auth.ts`, `server/routes/mobile/**`, `server/replit_integrations/object_storage/**`, admin/system routes in `server/routes/aiRoutes.ts`, `server/routes/kpiRoutes.ts`, and `server/routes/extendedRoutes.ts`.
- Public or bypassed surfaces needing explicit checks: `/api/portal/*`, `/api/mobile/*`, `/api/planner/*`, `/api/admin/*`, `/api/auth/*`, `POST /api/iot/signals`, `/objects/*`, `/api/storage/serve/objects/*`.
- Important production-scope notes from this scan:
  - `POST /api/uploads/request-url` is not unauthenticated in production because it remains under the normal `/api` middleware path; storage risk comes from weak authorization and unsafe serving behavior, not from public upload URL issuance.
  - The suspected mobile `email + any 4-6 digit pin` fallback login issue appears fail-closed in production because `/api/mobile/login` depends on tenant context that is not populated on the bypassed mobile path.
  - `/api/mobile/*` bypasses tenant middleware entirely. Handlers on that surface must derive tenant context from the authenticated mobile resource or `req.mobileTenantId`; reading `req.tenantId` on bypassed mobile routes is unsafe and can collapse traffic onto fallback/shared tenant identifiers.
  - The global API response logger in `server/index.ts` still records a 200-character JSON preview in production, but common token/password-style fields are now redacted first. Treat non-token PII-bearing endpoints as log-sensitive even though the earlier “raw bearer token logging” concern appears outdated in the currently inspected code.
  - Ordinary tenant membership still provides overly broad access to some operational control-plane routes. The current confirmed gaps include planner-only analytics under `/api/planning/*`, low-privilege optimization job creation, customer/staff notification send routes, and `POST /api/notifications/token`, which lets same-tenant users mint live WebSocket identities for arbitrary resources.
  - On bypassed mobile surfaces, the strongest current risk is horizontal misuse within the tenant rather than the earlier suspected fail-open tenant fallback. In the latest review, `server/routes/mobile/team.ts` let team leaders create immediately-active memberships for coworkers without acceptance and expose those coworkers' absence/workload data, while `server/routes/mobile/orders.ts` trusted caller-supplied participant/resource attribution fields during completion.
  - Several production routes live in `server/routes/mobile/misc.ts` despite using ordinary `/api/*` web paths rather than mobile bearer auth. In the latest review this file contained raw-ID checklist and quick-action handlers (`/api/checklist*`, `/api/quick-action`, `/api/checklist-templates/:id`) that relied on storage helpers without tenant predicates. Treat raw-ID helpers in `server/storage.ts` such as `getWorkOrder`, `updateWorkOrder`, `updateObject`, and checklist-template accessors as high-priority review points whenever a route does not independently verify tenant ownership.
  - Portal auth and storage paths require continued review even when the high-level flow looks hardened. The current scan confirmed public tenant/customer enumeration in portal login bootstrap, a portal-module disable-state bypass on session issuance and `/api/portal/me`, and an object-scope bypass in portal media signed-URL handling because storage ownership is checked only at the customer level.
  - Usually ignore unless production reachability is shown: seed/reset scripts, migrations, test helpers, mockup-only UI, and local-only tooling under `.local/`, `scripts/`, and prototype assets.

## Threat Categories

### Spoofing

Traivo uses several authentication models: Replit OIDC sessions for the main web app, custom portal sessions, and custom mobile bearer tokens. Every protected route must validate the correct identity type, and session or bearer tokens must be unpredictable, expire appropriately, and bind the caller to the intended tenant and role. Public-facing auth bootstrap endpoints such as portal login links and mobile login must fail closed in production rather than accept fallback tenant context or weak credentials.

### Tampering

Clients can submit operationally sensitive updates such as route changes, order status updates, photos, signatures, metadata, booking requests, and planning changes. The server must enforce tenant ownership, object ownership, and role-based permissions server-side for every mutating endpoint. Uploaded object paths, work-order IDs, resource IDs, and customer-controlled fields must never be trusted without authorization checks tied to the authenticated identity.

### Information Disclosure

The application stores customer, scheduling, and field-service data plus uploaded media that may include signatures, photos, addresses, and internal reports. API responses and object-serving routes must restrict access by tenant, role, and intended audience; uploaded files must not become world-readable merely because a path is guessable or returned to a client. Logs and error responses must avoid exposing secrets, tokens, raw credentials, or unnecessary PII.

### Denial of Service

Traivo includes shared caches, schedulers, AI integrations, external API calls, and upload/storage flows that can amplify cost or disrupt service. Public or low-privilege endpoints must not be able to trigger expensive cache flushes, repeated external calls, or unbounded upload/storage consumption. Authentication and token-issuance endpoints should be rate-limited enough to prevent brute force and resource exhaustion.

### Elevation of Privilege

Because the app is multi-tenant and role-based, the most important guarantee is that authentication alone never grants access to admin functions or another tenant's data. All `/api/admin/*` and other privileged routes must enforce admin/owner authorization explicitly, especially where normal tenant middleware is bypassed. Direct object references, mobile resource identifiers, tenant headers, and uploaded object paths must not let a user step outside their assigned tenant, role, or resource identity.
