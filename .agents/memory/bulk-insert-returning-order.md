---
name: Bulk INSERT…RETURNING order är inte garanterad
description: Vid fler-rads-INSERT där du måste binda DB-id tillbaka till käll-rader — pre-generera id istället för att lita på RETURNING-ordning.
---

# Bulk multi-row INSERT…RETURNING ordning

PostgreSQL garanterar INTE att `INSERT ... VALUES (...),(...) RETURNING ...`
returnerar raderna i samma ordning som VALUES-listan. Det fungerar nästan alltid
i praktiken, men är inte ett hållbart API-kontrakt.

**Regel:** När du batchar inserts och måste zip:a tillbaka det skapade id:t till
sin käll-rad (för att bygga hierarki, interim-map, metadata-intents osv) — lita
ALDRIG på positionell matchning mot RETURNING. Pre-generera id i JS och stoppa in
det i varje values-rad istället. `objects.id` är `varchar` med default
`gen_random_uuid()`, så det går att supplya ett explicit `randomUUID()` (override:ar
defaulten). Då bär raden + sitt id i samma objekt → ingen ordnings-risk, och
`.returning()` behövs inte alls.

**Why:** Felbunden id→rad vid fler-rads-INSERT ger inte bara kosmetiskt fel utan
data-korruption (fel förälder/metadata på fel objekt). Upptäckt i import-wizard
2.0 commit som batchade 891 objekt för att slippa ~106 s av sekventiella inserts.

**How to apply:** Gäller all bulk-create som mappar tillbaka skapade id (import,
copyObjectTree-liknande flöden, wizard-commit). Kombinera med beroende-"vågor" när
rader i samma batch refererar varandra som förälder: en rad är redo först när dess
förälder redan är skapad (tidigare steg/våg), så ingen rad i en våg refererar ett
syskon i samma multi-row-INSERT (självrefererande FK + cykel-trigger uppfylls).
