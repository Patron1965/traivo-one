---
name: Object repoint/move cycle guard
description: Repointing an object's parent must reject descendant targets (cycle), not just self-parenting.
---

# Object repoint must guard against descendant cycles

Any endpoint that changes an object's parent — `PATCH /api/objects/:id` (when body contains `parentId`) and `storage.moveObject` — must reject a new parent that is the object **itself OR any descendant of the object**. Blocking only `newParentId === objectId` is insufficient: choosing a descendant creates a cycle in both `objects.parentId` and the primary `object_parents` row, which corrupts hierarchy traversal, släktnamn/display-name computation, and metadata inheritance (all of which follow the primary chain).

**Why:** Bulk "Flytta till förälder" (and any client parent-picker) can only exclude the selected IDs, never their descendants, and the client must never be the authority. A descendant target silently produced a cyclic graph until a server-side guard was added.

**How to apply:** Use `storage.wouldCreateObjectCycle(tenantId, objectId, candidateParentId)` — it walks up the primary `objects.parentId` chain from the candidate (with a visited-set so pre-existing corrupt cycles don't infinite-loop) and returns true if it reaches `objectId`. Call it before the repoint transaction in the route (throw `ValidationError`) and defensively inside `moveObject` (throw). Null/top-level parent is always allowed.
