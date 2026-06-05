---
name: Article quantity expand wiring (3-mode + utgått→ersättning)
description: How article quantityMode expansion and replacement-article swap must be wired across all order-expand callers.
---

# Article quantity expand wiring

`articles.quantityMode` has 3 spec modes (per_styck/single_per_task→1, group→groupSize,
matches_field→object metadata value) plus legacy modes (use_object_quantity/configurable).
Central pure helper: `computeArticleQuantity` in `server/article-quantity.ts`. Every
order-expand caller must route through it so modes are interpreted identically.

**Callers that must honor it:** manual work-order lines (`workOrderRoutes`), order-concept
auto-mapping preview (`orderConceptRoutes`, matches_field intentionally falls back here —
resolved at real expansion), and Fortnox concept execute (`fortnoxRoutes`).

## matches_field MUST use the inheritance-aware resolver
`quantityMetadataField` stores the **Swedish katalog `namn`** (from `/api/metadata/types`),
NOT `metadataDefinitions.fieldKey`. Resolve the value via
`getArticleMetadataForObject(objectId, namn, tenantId)` (`server/metadata-queries.ts`),
which is inheritance-aware and matches on `katalog.namn`.

**Why:** objects in the concept/fortnox execute flows are loaded raw — `obj.metadata` is
**undefined** there (see the metaByObject batch-load comment), and metaByObject is keyed by
`fieldKey` (English system), so reading `obj.metadata?.[field]` silently returns nothing and
matches_field collapses to base quantity. Always resolve per-object via the helper.

## utgått → ersättning auto-swap
When an order references an `utgått` article with `replacementArticleId`, swap to the
replacement before computing price + quantity. Traverse the chain with a **visited-set cycle
guard** (multi-hop, replacement may itself be utgått) and a same-tenant check on each hop.
Apply in both `workOrderRoutes` (per line) and `fortnoxRoutes` execute (once before the loop;
also store the swapped id on the assignment article, not the raw concept.articleId).

**Tenant safety:** `replacementArticleId` accepted on article POST/PATCH must be validated to
belong to the same tenant (verifyTenantOwnership) — it's a cross-tenant FK vector otherwise.
Per-tenant article-number uniqueness is enforced app-level only (no DB unique index, by
design — multi-tenant + avoids breaking existing prod dup data).
