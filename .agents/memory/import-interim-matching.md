---
name: Interim-nummer som kundskopad matchningsnyckel
description: Hur importerade objekt numreras och hur re-import matchar på interimsnummer
---

# Interim-nummer: metadata + kundskopning (ej objectNumber)

Regeln: importerade interim-primärer får ett SYSTEMMYNTAT OBJ-NNN; interimsnumret
sparas separat som metadata (katalogfältet `interimsnummer`, konstant i
shared/objektmall-template.ts). Re-importmatchning = interim-metadatavärde +
objektets primära kund. Interim-identiteten är kundskopad ÄVEN inom en och samma
fil: gruppering/topologi/parent-uppslag i hierarkiplanen sker på nyckeln
interim+kund, så samma interimnummer till två kunder blir två oberoende objekt.

**Why:** objectNumber=MALL-<interim> matchade tenant-brett — en ny lista med samma
interimnummer till en ANNAN kund uppdaterade fel kunds objekt.

**How to apply:**
- Kandidat med ANNAN känd kund matchas ALDRIG; kandidat utan härledbar kund
  (saknad 'Kund'-metadata) får matcha vilken radkund som helst — annars ger en
  saknad kundkoppling tyst dubbletter vid varje re-import.
- Rad utan eget kundvärde ärver sitt interims ENTYDIGT deklarerade kund (så
  utrustningsrader inte splittras från sin primär), annars standardkunden.
- Bakåtkompat (expand-contract): MALL-<interim>-objectNumber matchas fortsatt
  som fallback men binds till högst EN kundskopad nyckel; uppdaterade
  legacy-objekt forward-migreras (interim-metadatat skrivs på dem). Skriv ALDRIG
  interim-metadata på rader som matchats via systemnummer.
- Flöden utan kundkolumn: flera metadata-träffar för samma interim = tvetydigt →
  radfel (kräv systemnummer).
- Testfälla: isolerade test-tenants saknar 'Kund'-katalogposten → objekten blir
  kund-lösa; seeda katalogposten för att testa kundskopning på riktigt.
