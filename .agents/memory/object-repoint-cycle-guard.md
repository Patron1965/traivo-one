---
name: Object repoint/move cycle guard
description: Repointing an object's parent must reject descendant targets (cycle), not just self-parenting.
---

# Object repoint must guard against descendant cycles

Any endpoint that changes an object's parent — `PATCH /api/objects/:id` (when body contains `parentId`) and `storage.moveObject` — must reject a new parent that is the object **itself OR any descendant of the object**. Blocking only `newParentId === objectId` is insufficient: choosing a descendant creates a cycle in both `objects.parentId` and the primary `object_parents` row, which corrupts hierarchy traversal, släktnamn/display-name computation, and metadata inheritance (all of which follow the primary chain).

**Why:** Bulk "Flytta till förälder" (and any client parent-picker) can only exclude the selected IDs, never their descendants, and the client must never be the authority. A descendant target silently produced a cyclic graph until a server-side guard was added.

**How to apply:** Use `storage.wouldCreateObjectCycle(tenantId, objectId, candidateParentId)` — it walks up the primary `objects.parentId` chain from the candidate (with a visited-set so pre-existing corrupt cycles don't infinite-loop) and returns true if it reaches `objectId`. Call it before the repoint transaction in the route (throw `ValidationError`) and defensively inside `moveObject` (throw). Null/top-level parent is always allowed.

## Two related traps

**Adding a parent must go through `storage.addObjectParentSafe`, never a raw `object_parents` insert.** Adding a relation without also mirroring `objects.parentId` (when it becomes the primary) is a **silent no-op**: the child inserts a row but never appears in the Barn card / descendants / metadata inheritance (all follow the primary `objects.parentId` chain). `addObjectParentSafe` does both in one tx and server-decides `isPrimary=(0 existing parents)` — never trust a client-supplied `isPrimary`. Same invariant on remove: `removeObjectParent` deletes → promotes oldest remaining → re-mirrors `objects.parentId` (or NULL if last) in one tx.

**`wouldCreateObjectCycle` only walks the PRIMARY chain, so it cannot catch alternate-parent cycles.** An object can have multiple parents (`object_parents`), but the guard only follows `objects.parentId`. An *alternate* (non-primary) relation A→B is invisible to it, so linking B→A afterwards creates a 2-cycle in the `object_parents` graph. Bounded today (enriched-path CTE has a depth<20 guard; inheritance follows only the primary chain), **but the pre-existing `setPrimaryParent` / `PATCH /:id/parents/:relId/primary` route has NO cycle guard** — promoting such an alternate injects the cycle into the primary chain itself. If you ever expose parent-promotion, add a full-graph cycle check there (traverse all `object_parents`, not just `objects.parentId`).
