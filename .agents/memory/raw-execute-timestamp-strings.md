---
name: raw db.execute returnerar timestamp som sträng
description: node-postgres via drizzle db.execute(sql``) ger timestamp-kolumner som strängar, inte Date — vanlig krasch-källa
---

# Råa db.execute()-rader: timestamp = sträng, inte Date

Med `drizzle-orm/node-postgres` returnerar **råa** `db.execute(sql\`...\`)`-queries
`timestamp`-kolumner som **strängar** (t.ex. `"2026-08-15 10:00:00"`), INTE som
JS `Date`. Detta skiljer sig från drizzles query builder (`.select()`) som mappar
kolumner till `Date`. Bekräftat: runnern kör i UTC (`TZ` tom, offset 0), så
sträng-roundtrip ger samma klockslag.

**Why:** Råa execute-rader saknar kolumn-typinfo som drizzle annars använder för
att deserialisera; pg ger oss råsträngen. Kod som antar `Date` och anropar
`.toISOString()` direkt kraschar med `TypeError: ... .toISOString is not a function`.

**How to apply:** Vid hantering av datum/timestamp-värden som kommer från
`getObjectWithAllMetadata` eller andra `db.execute`-baserade läsningar — wrappa
alltid i `new Date(value)` innan `.toISOString()`/date-metoder. `getDisplayValue`
(server/metadata-queries.ts) och `rawRowDisplay` gör nu detta; speglar du den
logiken någon annanstans, glöm inte coercion. Symptom om man missar: datetime-
metadatafält kraschar tyst i try/catch och funktioner faller tillbaka.
