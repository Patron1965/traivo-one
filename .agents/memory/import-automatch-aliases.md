---
name: Import auto-match aliases & threshold
description: Why real customer import headers fail auto-mapping and how to fix it safely (add aliases, never lower the fuzzy threshold)
---

# Import auto-match aliases (shared/object-import-spec.ts)

Real-world Swedish customer headers often land *just under* the fuzzy-match threshold
used by `autoMatchColumn`, so they silently fall through to manual mapping — a known
mis-map trap. Typos one char off the alias and plain headers (Postadress/Postnr/Ort/
Titel) commonly score below threshold or zero.

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

## Tenant-katalogmedvetna alias & aldrig-tyst-tapp (2026-08-10)
- Auto-match får även mappa mot tenantens AKTIVA metadata-katalog (namn/visningsnamn
  + kundrubrik-synonymer), men en synonym ger BARA träff om kandidatnamnet faktiskt
  finns i katalogen — aldrig blind mappning. Statiska alias + "namn" vinner alltid;
  fuzzy-tröskeln 0.8 gäller även katalognamn.
- **Regel: omatchade kolumner med data får aldrig tappas tyst.** Gaten måste vara
  serverauktoritativ: execute kräver aktuell validering (mappningsändring ogiltiggör
  den) + uttryckligt kvitto när data-bärande kolumner saknar mappning. En ren
  UI-checkbox räcker inte — API-klienter kan förbigå den.
- "Ignorera kolumn" måste persisteras som explicit `__empty`-mappning (aldrig
  delete:as) — annars går medvetet ignorerad inte att skilja från omatchad.
- Arkiverad katalog-klon kan skugga aktiv rad med samma namn (Objekttyp-fällan):
  läs-/skrivvägar måste föredra aktiv rad, och restore/lazy-create av katalograd
  måste serialiseras per (tenant, namn) med tx-bundet advisory-lock (namn-unikhet
  är app-nivå utan DB-constraint).

## Obligatorisk-regler (produktregel 2026-08-05)
- Metadata-mappningar är ALDRIG required i validateRow (även om klienten skickar required:true).
- Tomt objektnamn = WARNING, inte error: raden importeras och objektet får fallback-namn (name → system_id → interimId → "Namnlöst objekt") i execute.
- Klienten får inte hårdspärra på namn-mappning ("Validera"-knappen ska funka utan) — bara informativ hint + röd "Obligatoriskt"-badge på name-mappad kolumn.
- Bare "namn"-alias borttaget ur KNOWN_FIELDS (kontaktpersons-fälla); exporterna emitterar "Objektnamn".
