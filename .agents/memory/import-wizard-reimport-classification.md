---
name: Import-wizard reimport classification
description: Why the 3-step import-wizard's "redan inlagd"-banner count can be lower than the number of re-pasted rows.
---

# Import-wizard (3-steg) reimport-klassning

`validateRows` (`server/routes/importWizardRoutes.ts`) kör i två faser per rad:
1. `normalizeRow` → Zod-validering (schema per steg).
2. Endast rader som passerar fas 1 når dubblett-loopen.

Dubblett-loopen skiljer på två fall:
- **Session-dubbletter** (interim-ID committat i ett TIDIGARE steg): kolla
  ORIGINAL-`interimMap`, INTE `localMap`. `localMap` innehåller pseudo-rader
  (`<pending>`) från samma batch, så den skulle felklassa in-fil-dubbletter.
  Driver `reimport.alreadyCommitted` + `reimport.steps`.
- **In-fil-dubbletter** (samma interim-ID två gånger i samma inklistring): via
  `seenInterimInBatch`. Räknas INTE som reimport.

**Konsekvens (by design, inte en bugg):** Om en användare återklistrar ett
tidigare stegs fil i ett senare steg, failar rot-raden (tom förälder) i fas 1
eftersom steg 2/3 kräver `parentInterim` — den når aldrig dubblett-loopen och
ingår därför INTE i `reimport.alreadyCommitted`. Därför kan bannern visa "X av Y
rader" där X < (antal rader som faktiskt redan finns). Rot-radens egna,
tydliga Zod-felmeddelande täcker dess fall separat.

**Why:** prod-förvirring uppstod när hela steg-1-filen klistrades in i steg 2 —
de flesta rader gav "finns redan i sessionen" medan rad 1 gav ett kryptiskt
`parentInterim: Required`. Bannern + svenska Zod-meddelanden förklarar nu vad
som hänt.

**How to apply:** Rör du reimport-räkningen eller bannern — anta inte att
`alreadyCommitted === antal kolliderande interim-ID`. Rader som failar schema
först exkluderas medvetet. `reimport.total = rawRows.length` (alla inskickade
rader, för andels-beräkning).
