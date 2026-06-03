---
name: Computed (derive-on-read) metadata fields
description: How "Beräknat" metadata catalog fields stay readonly and authoritative; the two-sided enforcement required.
---

# Computed metadata fields (arBeraknad + formel)

A `metadata_katalog` type can be marked `arBeraknad` with a `formel` that
references sibling fields in the same family (`parentMetadataId`), e.g.
`langd * bredd`. The value is **derived on read** in `getObjectWithAllMetadata`
(server/metadata-queries.ts) and surfaced as a synthetic readonly entry
(`source: 'computed'`, id `computed-<katalogId>`). Engine: `server/metadata-formula.ts`
(safe recursive-descent, no eval; only `+ - * /` and parentheses).

**Rule: derive-on-read must be authoritative on BOTH sides.**
- Write paths (`createMetadata` / `updateMetadata`) must reject any katalog type
  with `arBeraknad === true` (Swedish 400). Otherwise a manual value gets
  persisted in `metadata_varden`.
- Read path must strip stored rows whose katalog type is computed *before*
  building sibling base values. A leftover stored row (e.g. a field that was
  normal and later made computed) would otherwise both display instead of the
  computed value AND feed its stale number into other formulas in the family.

**Why:** without write-rejection a computed field is silently writable; without
read-strip a legacy stored value permanently overrides the formula and corrupts
sibling computations. Architect review caught both gaps; fixing only one is
insufficient.

**How to apply:** any future derive-on-read / formula-backed field type needs the
same pair (block writes + ignore stored values on read), plus exclude it from the
client "add metadata" list and never render edit/delete on `source: 'computed'`.

Invalid formulas (unknown field, div-by-zero, circular ref) fail gracefully
**per field** with a Swedish message in `computedError` and never break sibling
fields — preserve that contract.
