---
name: import_batches.session_id utan FK
description: Varför kolumnen behölls när import_sessions droppades och varför den aldrig får FK igen
---

Regel: `import_batches.session_id` är en fri varchar utan FK. Den stämplas av Import 2.0
(objects-v2-flödet) med `object_import_sessions`-id för Ångra-spårbarhet.

**Why:** Tabellen `import_sessions` (tre-stegs-wizarden) är borttagen (contract-fas,
migration 0142). Den historiska FK:n (migration 0049) pekade dit — en FK mot
`object_import_sessions` vore fel eftersom kolumnen historiskt innehåller id:n från
båda källorna, och sessioner kan rensas oberoende av batch-historiken.

**How to apply:** Vid schemastädning/drift-analys: låt kolumnen + `idx_import_batches_session`
vara; lägg aldrig tillbaka en FK. Vid contract-drops generellt: kolla FK:er FRÅN andra
tabeller in i tabellen som droppas — droppa dem explicit i migrationen (idempotent), och
kontrollera om den refererande kolumnen har levande konsumenter innan den tas bort.
