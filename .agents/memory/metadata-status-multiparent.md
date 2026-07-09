---
name: Metadata statusmodell & multi-förälder-arv
description: Regler för status='aktiv'-filter i alla metadata-läspaths, G1 auto-arkivering och konfliktpredikatet vid arv från flera föräldrar.
---

# Statusmodell (Aktiv/Arkiverad/Anonymiserad)

Regel: varje metadata_varden-rad har logisk `status` ('aktiv' default). Arkiverade poster är FULLVÄRDIGA rader (klonade via insertArchivedClone), inte historikrader — de deltar ALDRIG i arvsupplösning eller närmaste-värde-visning.

**Why:** G1-beslutet — nytt värde på enkelvärdesfält (allowDuplicates=false) arkiverar det gamla som fullvärdig post, oavsett skrivväg. `raderad` kvarstår som TEKNISK mekanik för brutet arv (tombstone); användarens terminologi är enbart status ("raderad" borta ur UI).

**How to apply:**
- Varje NY läspath mot metadata_varden måste filtrera `status='aktiv'` (arvda: dessutom `raderad=false`; lokala: `status='aktiv' OR raderad=true` för struken-visning). Medvetet OFILTRERADE: usage-/confirmUsage-räknare och undo-snapshots.
- Alla ställen som bygger MetadataVarden-objekt i minnet (push-sites i CTE-mapparna) måste inkludera ALLA kolumner ($inferSelect kräver även nullable: raderadAv/raderadVid/arkiveradAv/arkiveradVid/konverteradFranHistorikId) — tsc-fel TS2345 vid saknad.

# Multi-förälder-arv & konfliktpredikat

Regel: arv traverserar object_parents UNION legacy parent_id (cykelskydd via path); primär gren vinner vid lika nivå. `inheritanceConflict` sätts ENDAST när värden på närmaste nivå kommer från OLIKA källobjekt (distinct objekt_id > 1) OCH har olika värden.

**Why:** en enskild förälder med flera värden (allowDuplicates/multi-instans) är data från samma källa — inte en konflikt; utan distinct-source-kravet flaggas falska "Arvskonflikt"-varningar.

**How to apply:** ändra aldrig konfliktblocket i getObjectWithAllMetadata utan att behålla tre villkor: >1 rad på min-nivå, >1 distinkta värden, >1 distinkta källobjekt. Konfliktkällor dedupliceras per (källa, värde). `tillat_uppdatering_uppat` i metadata_katalog är inert (v1) — UI-switch disabled.
