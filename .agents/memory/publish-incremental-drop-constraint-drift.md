---
name: Publish incremental migration fails on stale DROP CONSTRAINT
description: When Replit Publish "Migrations failed validation" is caused by a DROP CONSTRAINT that doesn't exist in prod (schema drift), and the overwrite escape hatch.
---

# Publish "Migrations failed validation" från stale DROP CONSTRAINT

## Symptom
Replit Publish fastnar på **"Migrations failed validation, please review"** utan fortsätt-knapp. Utfälld feltext (längst ner, under datavarningarna + SQL-preview):
```
Failed to run database migration statement
ALTER TABLE "teams" DROP CONSTRAINT "teams_cluster_id_clusters_id_fk";
constraint "..." of relation "teams" does not exist
```

## Orsak
Publish-flödets auto-genererade diff (dev↔prod) skapar `DROP CONSTRAINT` **utan `IF EXISTS`**. Om produktionens schema glidit isär från dev (constraint saknas / heter annat i prod) failar satsen och HELA den stegvisa migrationen underkänns i valideringen. Datavarningarna (kolumn-drops) är INTE orsaken — leta alltid upp den utfällda "failed validation"-raden för den riktiga feltexten.

## Vad som INTE går att göra
- Agenten får aldrig köra DDL mot prod, inte redigera Replits genererade migration-SQL, inte lägga till `IF EXISTS`. Den stegvisa vägen kan alltså inte lagas från koden.

## Lösning (sanktionerad platform-utväg)
Publish-rutan erbjuder två val vid schema-konflikt:
1. **"Copy your development database schema & data to production"** ← välj denna
2. "Cancel deployment and retry once your schema conflicts are resolved" (förvald)

Alt 1 gör prod till en EXAKT kopia av dev (struktur + data) och hoppar över den trasiga stegvisa migrationen → publiceringen går igenom.

**Why:** wholesale copy använder inte inkrementella ALTER-satser, så den träffar aldrig den saknade constrainten.

**How to apply:** ENBART säkert när produktionsdatan är slask/ej i drift (kopian skriver över prod med dev-datan, inkl. ev. demo-data). Bekräfta med användaren att prod-data får ersättas innan du rekommenderar alt 1. Klicka radio-knappen för alt 1 → blå knappen byter till bekräfta/kopiera → kör.
