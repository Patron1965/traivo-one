---
name: metadata_katalog universal-key uniqueness & soft-delete restore
description: How per-tenant uniqueness of metadata_katalog namn/beteckning must be enforced, and why soft-deleted types must be restorable.
---

# metadata_katalog universal-key uniqueness & soft-delete

The Swedish `metadata_katalog.namn` and `metadata_katalog.beteckning` are per-tenant
unique "universal keys" (they bind import-matching, concept filters, search/filter).
Uniqueness is enforced **only at application level** — there is no DB unique
constraint yet.

## Rules
- Every write surface must check uniqueness **case-insensitively** (`lower()=lower()`)
  AND against **both active and soft-deleted (archived, `deletedAt`) rows**. Use
  `findMetadataTypeByIdentity(tenantId, field, value, {archived, excludeId?})`
  (server/metadata-queries.ts) — it is the single CI+archived lookup helper.
- There are **two write surfaces for the same table** that must stay in lockstep:
  `/api/metadata/types` (POST create + PUT rename, server/metadata-routes.ts) and
  `/api/metadata-labels` (POST + PATCH, server/routes/kpiRoutes.ts). Adding a check
  to one but not the other reopens the bypass.
- An active CI collision → plain 409 "finns redan". An **archived** CI collision →
  structured 409 (`code: "ARCHIVED_METADATA_TYPE_EXISTS"`, `field`, `archivedTypeId`)
  that points the user to restore instead of silently duplicating or auto-resurrecting.
- Soft-deleted (archived) types still occupy the key namespace, so the UI **must**
  surface them for restore (MetadataSettingsPage "Arkiverade metadatatyper" section +
  `GET /types/archived` + `POST /types/:id/restore`). Restore must reject (409) if an
  active CI duplicate exists — telling the admin to archive/rename the active one first.

## Why
Case-SENSITIVE checks let "Kontakt" and "kontakt" coexist while the seed dedups
case-insensitively. Combined with soft-delete that had no restore path, a deleted type
became invisible yet kept its key → users could neither recreate it nor see/restore it
(a silent dead-end). This was the original "hitta bugg" report.

## How to apply
Whenever you touch any metadata_katalog writer (create, rename, import, label CRUD),
run the CI+archived check on namn and beteckning. Future hardening: a DB functional
unique index on `(tenant_id, lower(namn))` and `(tenant_id, lower(beteckning))` after
existing prod duplicates are cleaned up, for race resistance.
