---
name: Article quantity expand wiring (modes + utgått→ersättning)
description: How article quantityMode expansion and replacement-article swap must be wired across all order-expand callers.
---

# Article quantity expand wiring

`articles.quantityMode`: `single_per_task`→1, `group`→groupSize, and the metadata-driven
modes `per_styck` + `matches_field`→object metadata value (else baseQuantity), plus legacy
`use_object_quantity`/`configurable`→base. Central pure helper: `computeArticleQuantity` in
`server/article-quantity.ts`. Every order-expand caller must route through it so modes are
interpreted identically.

## per_styck is the metadata-driven DEFAULT; matches_field is a legacy alias
The spec's default mode "Per styck" IS the metadata-field-driven mode (admin picks which
object metadata field gives the count, e.g. "Antal kärl"). It uses the object metadata value
when present & >0, else falls back to baseQuantity. The older separate `matches_field` value
behaves identically and is kept only as a back-compat alias for un-resaved rows — the
ArticleForm folds `matches_field`→`per_styck` on load and no longer offers it in the dropdown.
**Never gate metadata resolution on a literal mode string.** Use the exported helper
`usesQuantityMetadata(mode)` (true for per_styck||matches_field) so future modes are handled
in one place.

**Why:** per_styck with an empty `quantityMetadataField` must stay == base (it was the prior
behavior for every per_styck/migrated row), so the change is backward-compatible ONLY because
empty-field → null metadataValue → base. Before deploying a change that makes per_styck
metadata-capable, audit prod for `quantity_mode='per_styck' AND quantity_metadata_field <> ''`
(would silently change invoiced quantities); dev was clean.

**Callers that must honor the helper:** manual work-order lines (`workOrderRoutes`
resolveOrderLineQuantity), Fortnox concept execute (`fortnoxRoutes`), and the metadata-change
propagation job (`metadata-change-jobs` propagateTaskQuantities, which recomputes
non-finalized assignments when an object's metadata changes — completed/cancelled frozen).
`orderConceptRoutes` auto-mapping preview intentionally falls back to stored line qty
(metadata resolved later at real expansion).

## metadata-driven modes MUST use the inheritance-aware resolver
`quantityMetadataField` stores the **Swedish katalog `namn`** (from `/api/metadata/types`),
NOT `metadataDefinitions.fieldKey`. Resolve the value via
`getArticleMetadataForObject(objectId, namn, tenantId)` (`server/metadata-queries.ts`),
which is inheritance-aware and matches on `katalog.namn`.

**Why:** objects in the concept/fortnox execute flows are loaded raw — `obj.metadata` is
**undefined** there (see the metaByObject batch-load comment), and metaByObject is keyed by
`fieldKey` (English system), so reading `obj.metadata?.[field]` silently returns nothing and
the quantity collapses to base. Always resolve per-object via the helper.

## "formula" is the third Antalskälla; execution edits are lifecycle-locked + audited
`articles.quantityFormula` drives mode `formula`: `usesQuantityFormula(mode)` true → resolve
via `parseFormula` refs → `getArticleMetadataForObject` per ref → `evaluateFormula`, then
`computeArticleQuantity` (positive result wins, else falls back to base). DB-aware glue lives
in `resolveEffectiveArticleQuantity` (`server/article-quantity-resolver.ts`); hard syntax/ref
validation happens at article save, soft fallback at execution so dispatch/export never break.

Quantity edits to a work-order line at execution are **blocked once the WO enters the invoice
lifecycle** — `invoiceQueueState` ∈ {held,pending,consolidated,exported} OR
`consolidationInvoiceId` set → 409 ConflictError. **Why:** changing qty after the invoice basis
is frozen/sent would mis-bill. **The `frozen_*` snapshot fields are deliberately NOT the lock**
— they are back-compat/snapshot fields outside the queue lifecycle; gate on the queue state.
Every successful exec qty change writes audit action `work_order_line.quantity_changed`
(from/to, performer+role, WO/article ids) best-effort-but-loud, BEFORE the metadata writeback.

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

**The chain-resolver must tenant-check the INITIAL article, not just the hops.** The shared
`resolveActiveArticle(tenantId, article)` (`server/services/order-concept-article-hits.ts`) is
the single source the order-concept hit/economics flow uses (preview, run-rolling, execute,
`article-hit-summary`). It returns `undefined` when `article.tenantId !== tenantId` BEFORE
following the utgått→ersättning chain. **Why:** the concept-write path (PATCH
`/api/order-concepts/:id`) does not validate that `concept.articleId` belongs to the tenant, so
a tenant could point a concept at a foreign article; the inline chain-followers only guarded the
replacement hops (`repl.tenantId !== tenantId`), leaving the entry article unchecked → would
leak foreign article name/price and could expand against it. When migrating any inline
"prefetch entity + follow chain" block to a helper, the entry entity needs the same tenant gate
the hops already have — easy to miss.

## concept_articles.metadataAssociation / metadataCorrespondence are write-only/vestigial
These two `concept_articles` columns ("Hakar fast på" / "Antal styrs av") are ONLY written by
the concept-article POST/PATCH handlers in `orderConceptRoutes.ts` (and auto-populated from
`article.defaultMetadataAssociation` in the wizard) — they are **never read** in
expansion/preview/targeting. The authoritative sources are the ARTICLE definition: matching
("fasthakning") = `articles.associationRules` (`server/association-service.ts`, `storage.ts`),
quantity = `articles.quantityMode`/`quantityMetadataField`/`quantityFormula` (resolved in
`resolveConceptArticleHits`). The wizard Step 6 (`Step6Tasks.tsx`) deliberately no longer
exposes editors for these — Step 6 is just add-article + base quantity + pre-task offset.
**Why:** keep the columns as expand-contract back-compat, but never wire expansion to read
them; if you need article-to-object matching or metadata-driven quantity, go through the
article definition, not these fields.
