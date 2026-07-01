---
name: Invoice billing-segment canonical key
description: segmentKey is the single grouping identity for metadata-driven invoice consolidation; keep it consistent across all three paths.
---

Metadata-driven invoice splitting ("Faktura från toppen" + Fakturastopp-brytpunkter
+ gruppering på metadatafält) composes on top of the existing frozen
recipient/customer consolidation. Each held WO freezes a `billing_segment_key` at
ready-time; `customer_invoices` carry the same audit columns.

**Rule:** `billingSegmentKey` is the ONE canonical grouping identity. Format
`b:<breakObjectId|->|g:<groupingValue|->`, and it is `NULL` when there is neither a
break nor a grouping value (NULL segment = exactly today's behavior, full
back-compat). It encodes the break node id and the grouping VALUE, but deliberately
NOT the grouping field NAME.

The key is consumed in FOUR places that must stay in lockstep:
1. in-memory grouping during a consolidation run (group key = baseKey + segmentKey),
2. the cross-run additive-merge match conditions (eq segmentKey, or isNull for NULL),
3. the LIVE preview route (groups by baseKey + segmentKey),
4. the fakturalås-gate (BY+CE "allt klart innan faktura") — releases a WO only when
   every open sibling in the SAME group is done. The group MUST equal the consolidation
   group or a finished group is held hostage by an unrelated one. So both consolidation
   and the gate build the key via the shared `canonicalBaseKey(wo)` (r:<recipient> before
   c:<customer>) + `composeGroupKey(base, segmentKey)` helpers — ONE source of truth. The
   gate cannot filter on the frozen billingSegmentKey column in SQL (NULL until release),
   so it recomputes the segment via the same `resolveWoSegment` used at freeze-time and
   threads it into the release so the frozen key == the key it gated on (no drift).

**Why:** if you add an extra dimension (e.g. `billingGroupingFieldName`) to only one
of those paths — e.g. only the cross-run merge match — the paths disagree: two WOs
with the same segmentKey still merge in-memory within a single run but would be
treated as distinct across runs. That inconsistency is worse than the extreme edge
case it tries to fix (admin changing the grouping field mid-period to a different
field that yields the same value string). The architect confirmed segmentKey-as-sole-
identity is the correct, acceptable design.

**How to apply:** never widen the consolidation grouping identity in just one path. If
the segment identity ever needs another dimension, add it to the segmentKey itself
(so all three consumers pick it up automatically), not as a side condition on one
query.
