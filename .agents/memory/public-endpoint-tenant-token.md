---
name: Public endpoint tenant resolution
description: Unauthenticated tenant-scoped endpoints must not accept a raw tenant slug/id
---

Public (unauthenticated, tenant-middleware-bypassed) endpoints under `/api/public/*`
must NOT resolve tenant from a caller-supplied raw tenant id/slug (e.g. `?tenant=kinab`).
A guessable tenant id lets anyone enumerate tenants and pull tenant-scoped data
(branding, object names/addresses). This is the cross-tenant information-disclosure
risk called out in `threat_model.md`.

**Pattern:** resolve tenant server-side from an opaque, unforgeable value.
For object-bound QR there is `qr_code_links.code` (`storage.getQrCodeLinkByCode`).
For object-agnostic ("dynamic") QR, `qr_code_links.objectId` is NOT NULL so a row
can't be reused without a schema change — instead use an HMAC-signed token:
`server/dynamic-qr-token.ts` (`signDynamicQrToken`/`verifyDynamicQrToken`, keyed on
`SESSION_SECRET`). The signed token is minted by an authenticated planner endpoint
(`GET /api/cases/dynamic-qr-token`) and verified on the public routes; invalid →
404 "Ogiltig kod". Always pair with Zod validation (lat/lng bounds, category enum,
length caps) on the public body/query.

**Why:** authentication-free surfaces are the highest-risk boundary; never let the
client choose which tenant's data it reads.
