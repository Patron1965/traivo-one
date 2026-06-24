---
name: Matching-import metadata key = bare namn
description: Which metadata header key round-trips through the matching import (/import, Import 2.0) vs the objektmall import.
---

# Two object-imports use DIFFERENT metadata header keys

Any CSV/Excel column meant to round-trip metadata back IN must use the key the
*target* importer matches against. The two importers disagree:

- **Matching import (Import 2.0, `/import`, `/api/import/objects-v2/fields`)** exposes
  every catalog field as **`metadata.<namn>`** — the bare `metadata_katalog.namn`.
  Execute resolves it via `ensureKatalogRow(namn)`. `metadata_katalog.namn` is unique
  per tenant, so even a *family child* field (one with `parentMetadataId`) resolves to
  the correct row by its own `namn`. **No dot-notation here.**
- **Objektmall import (`buildMetadataTypeLookup` / `resolveTemplateFieldHeaders`)** uses
  the dotted **`deriveMetadataDotKey` = parent.namn + "." + child.namn** for family
  children (and bare `namn` for roots).

**Why:** On the matching import path, a dotted `metadata.Parent.Child` header is caught
by `groupMetadataForWrite`, which treats any dotted key as a JSON *group* and writes it
into one json katalog named `Parent` (subfield `Child`) — NOT the child katalog row. So a
dotted key silently mis-routes a family-child value into the wrong field.

**How to apply:** When building an export whose stated round-trip target is the matching
import (`/import`), emit `metadata.<namn>` for each catalog field — never the dot-key.
Reserve `deriveMetadataDotKey` strictly for objektmall-import artifacts. (Case caveat:
auto-match lowercases headers while `ensureKatalogRow` matches case-sensitively, so a
mixed-case `namn` may auto-create a dup unless the user confirms the mapping in the
"Matcha data" step — inherent to the import, out of scope for exporters.)
