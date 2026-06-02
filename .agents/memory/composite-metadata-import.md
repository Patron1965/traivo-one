---
name: Composite metadata fields (dot notation) in objektmall import
description: How same-prefix dotted columns become one structured JSON metadata value, and why JSON storage is forced.
---

# Composite metadata fields via dot notation

Objektmall (Excel object import) supports composite metadata columns using dot notation
in the reference-name row: `adress.gata`, `adress.gatunummer`, `adress.postnummer`,
`adress.ort`. Columns sharing a prefix before the first dot group into ONE logical field
stored as structured JSON.

Convention helper `parseCompositeRef(refName)` lives in `shared/objektmall-template.ts`
(separator = "."). It splits at the FIRST dot only (subfield may itself contain dots),
rejects dot-at-start and empty parts. Both backend parser and both UIs import it so the
convention is interpreted identically everywhere.

## Storage decision: always force JSON

Composite values are written via the SAME metadata write path as ordinary definition
columns (`writeImportedMetadataValue` → `coerceMetadataVardeFromRaw`), but the katalog
definition is wrapped with `asJsonKatalog(kat)` which forces `datatyp:"json"` and nulls
`allowedValues`. This routes the value into `metadata_varden.varde_json` regardless of the
definition's declared datatype.

**Why:** reusing the existing post-it model (replace/add/unchanged, history archival,
tenant predicates) avoids a parallel write path. Forcing JSON is the minimal lever that
makes the generic coerce/store path produce structured storage.

**How to apply:** the composite prefix (e.g. `adress`) must still match a `metadata_katalog`
definition by namn OR beteckning (case-insensitive) — unmatched prefixes warn + skip the
whole group, consistent with flat unknown columns. The matched definition is what gets
JSON-forced; its id is what loads existing values for status diffing.

## UI detection (display/edit)

`ObjectMetadataPanel.tsx` treats a `json`-datatyp entry whose `vardeJson` is a flat object
of primitive values as a composite field: it renders subfields grouped (label per key) and
edits them with one input per subfield. The editor keeps state as a JSON string so the
existing `handleSave` (JSON.parse for json datatype) works unchanged. Nested objects or
arrays fall back to the plain JSON input — do not assume every json field is composite.
