---
name: Import auto-match aliases & threshold
description: Why real customer import headers fail auto-mapping and how to fix it safely (add aliases, never lower the fuzzy threshold)
---

# Import auto-match aliases (shared/object-import-spec.ts)

Real-world Swedish customer headers often land *just under* the fuzzy-match threshold
(0.8) used by `autoMatchColumn` (server/services/object-import-core.ts), so they
silently fall through to manual mapping — a known mis-map trap users hit.

Measured similarity vs the intended alias key: `intrumnummer` ≈ 0.79 vs
`interimsnummer`; `överordnat objekt` ≈ 0.24 vs `interimföräldranummer`. Plain
headers like Postadress / Postnr / Ort / Namn / Titel / Telefon scored 0 (no match).

**Rule:** fix by adding explicit lowercase aliases to `KNOWN_FIELDS` /
`ADDRESS_PATTERNS` / `CONTACT_PATTERNS`, NOT by lowering the 0.8 threshold.
**Why:** lowering the threshold causes false positives across *every* file;
targeted aliases only help the exact headers you name. `autoMatchColumn` checks
exact membership in those three dicts first (score 1.0), and `ALIAS_TO_KEY` /
`ALL_KNOWN_KEYS` are derived from them, so adding a key is the whole fix — no other
wiring needed.

**How to apply (key format):** `normalizeHeader` = trim + lowercase only — it
preserves spaces, hyphens and å/ä/ö. So alias keys must be lowercase with those
chars intact (e.g. `"överordnat objekt"`, `"e-post"`).

**Deliberately NOT aliased: bare `namn` → contact.name.** In most migration files
`Namn` IS the object-name column, so auto-mapping it to contact would recreate the
very mis-map trap we are removing. Leave it as a manual one-click mapping. (Axfood's
file is the unusual case that uses `Objektnamn` for the object and `Namn` for the
contact person.)
