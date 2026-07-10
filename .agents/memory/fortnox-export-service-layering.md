---
name: Fortnox client vs export-service layering
description: fortnox-client.ts is pure API surface; business logic (idempotency, retries, logging) lives in fortnox-export-service.ts.
---

`server/fortnox-client.ts` contains ONLY the `FortnoxClient` class (raw HTTP calls, OAuth, API type interfaces) plus `createFortnoxClient()`. All export orchestration — atomic claim-for-processing, idempotency lookup via `ExternalInvoiceReference2`, retry/wait metrics, and export-log persistence — lives in `server/services/fortnox-export-service.ts`.

**Why:** the client needs to be a pure API wrapper so it can be tested/mocked independently of business rules, and so idempotency/logging logic has one home instead of being duplicated across call sites (routes, invoice queue, credit flow).

**How to apply:** Any new Fortnox-touching feature should add orchestration to `fortnox-export-service.ts` (or a sibling service), never back into `fortnox-client.ts`. Idempotency key = the export's `id`, written to Fortnox as `ExternalInvoiceReference2`; look it up via `findInvoiceByExternalReference2` before creating a new invoice on retry. The lookup must be treated as fail-closed — if it errors, abort the export rather than proceeding to create an invoice, since a lost prior response would otherwise cause a duplicate.
