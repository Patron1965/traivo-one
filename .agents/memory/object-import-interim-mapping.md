---
name: Import 2.0 interim→object mapping
description: Why the interim→object id map must only be written for primary rows during object-import execute.
---

# Import 2.0 (objectImportV2Routes) interim→object mapping

In Import 2.0's execute path, equipment rows (kärl/utrustning) **share the same
`interim_id` as their store/butik** but have an empty `interim_parent_id`. The
hierarchy plan (`buildHierarchyPlan`) marks exactly one row per interim group as
`kind:"primary"` and the rest as `kind:"equipment"`; equipment is parented under
the primary via the shared interim id (`interimToObjectId.get(interimId)`).

**Rule:** only set `interimToObjectId.set(interimId, objectId)` for rows where
`item.kind === "primary"` — on BOTH the create and update branches.

**Why:** if either branch writes the map for equipment rows, later equipment
rows in the same group resolve their parent to another equipment object instead
of the store → silent hierarchy corruption.

**How to apply:** any future change to the execute loop that records id mappings
keyed by interim id must keep the `kind === "primary"` guard. Primary selection
itself: row with non-empty `interim_parent_id`, else first row in the group —
deterministic and spec-aligned (equipment never carries `interim_parent_id`).
