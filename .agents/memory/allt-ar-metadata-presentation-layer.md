---
name: "Allt är metadata" — Steg 1 presentationslager
description: Produktägarens 7-stegs objektsida-ombygge; Steg 1 (P1) är PRESENTATION-ONLY — legacy-objektkolumner projiceras genom den enhetliga metadata-ytan, aldrig datamigrering.
---

# "Allt är metadata" — Steg 1 (P1) presentationslager

Produktägaren har godkänt ett 7-stegs ombygge av objektsidan där ALLA objektdata
på sikt ska bo i metadatamodellen (svenska katalogen: `metadata_katalog`/`_varden`/`_historik`).
Steg 1 (P1, "Kritisk") är **presentation-only** — INGEN datamigrering.

## Regel
Legacy-objektkolumner (accessType/accessCode/keyNumber/accessInfo, containerCount,
serialNumber/manufacturer/purchaseDate/warrantyExpiry/lastInspection, notes …)
renderas genom den enhetliga metadata-ytan (ObjectMetadataForm) som **syntetiska,
read-only metadata-rader**, men får ALDRIG nå metadata_varden save/delete-vägarna.
Syntetiska rader bär guards (`legacyColumn`/`legacyEditGroup`) och saknar
`metadataKatalogId`; redigering routas till objektets befintliga PATCH-yta
(openEditDialog → `PATCH /api/objects/:id`), inte metadata_varden.

**Why:** expand-contract — kolumnerna matar fortfarande routing/VRP/mobil/Fortnox,
så de får inte flyttas eller tas bort i P1. Katalog-seeding, dual-write och
kolumnborttagning är MEDVETET uppskjutna till senare steg. Arkitektens P1-verdikt
var uttryckligen "presentation-layer only".

**How to apply:** när du bygger vidare (P2–P7) — flytta inte data eller ta bort
kolumner utan att steget uttryckligen kräver det; håll legacy-rader firewallade
från metadata-mutationer; nya objektfält som ska visas men ännu inte migrerats
läggs till via legacy-adaptern, inte som riktiga katalogposter.

## KÄLLA-taxonomi (source-tags)
Den enhetliga ytan taggar varje rad med ursprung: **D**=driftdata, **M**=manuell,
**S**=systemkatalog, **SYS**=systemgenererat. Legacy-rader = M; systemgenererade
kort (adress/position-härlett, Karta) = SYS. Håll SYS-origin-metoderna i lockstep
med READONLY-origin-setet i ObjectMetadataForm (idag: system/tjanst/utforande).

## Djuplänkar
Gamla `?tab=access` / `?tab=equipment` mappas nu till metadata-sektionen
(TAB_TO_SECTION → "metadata"), eftersom objektfälten flyttat in i den enhetliga
ytan. Det tidigare tomma ankaret är borttaget.
