---
name: WO-metadata edit + free-string query-key encoding
description: Two gotchas when editing work-order-metadata values and when a query key segment is a free string.
---

# Work-order-metadata "edit" has no update endpoint

The work-order-metadata path (`POST /api/metadata/work-orders/:workOrderId` with
`{metadataTypNamn, varde}`) **always INSERTs** — there is no update/upsert endpoint.
So "editing" a value = create new + delete old.

**Rule:** do POST (create new) FIRST, then DELETE the old row only after POST succeeds.
**Why:** DELETE-then-POST loses the value permanently if the POST fails (network/validation).
POST-then-DELETE's worst case is a transient duplicate row (visible after refetch), never data loss.
**How to apply:** any client flow that replaces a WO-metadata value (e.g. coupled-field save in
JobDetailModal). A truly atomic transactional replace endpoint would remove even the duplicate window.

# Default react-query fetcher does NOT URL-encode query-key segments

`getQueryFn` in `client/src/lib/queryClient.ts` builds the URL via `queryKey.join("/")` with
**no encoding**. If a path segment is a free string (spaces, å/ä/ö, slashes), the request breaks.

**Rule:** when a query-key segment is a user-controlled free string used as a path param, supply a
custom `queryFn` that `encodeURIComponent(...)`s the segment instead of relying on the default fetcher.
**How to apply:** e.g. `order_type` (free string) endpoints. Express decodes %-encoding back into
`req.params`. (An encoded `/` in the value is still a path-routing edge case — avoid `/` in such keys.)
