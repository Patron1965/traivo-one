---
name: Import-wizard reimport classification
description: Why the import-wizard "redan inlagd"-banner count can be lower than the number of re-pasted rows.
---

# Import-wizard reimport-klassning

**Durable rule:** Reimport-räkningen ("redan inlagd i sessionen") räknar BARA rader
som först passerat schema-validering. Rader som failar schemat (t.ex. en rot-rad
utan förälder återklistrad i ett steg som kräver förälder) når aldrig
dubblett-klassningen och exkluderas medvetet ur reimport-träffarna — men ingår i
totalen (alla inskickade rader). Därför kan bannern visa "X av Y" där X är färre
än antalet rader som faktiskt redan finns.

**Why:** prod-förvirring uppstod när en hel fil från ett tidigare steg klistrades
in i ett senare steg: de flesta rader gav "finns redan", men den schema-failande
rot-raden gav ett separat kryptiskt valideringsfel istället för att räknas som
reimport.

**How to apply:** Antag aldrig `alreadyCommitted === antal kolliderande rader` när
du rör reimport-räkningen eller bannern. Schema-failande rader är avsiktligt
exkluderade från träffarna men inräknade i totalen för andels-beräkning.
