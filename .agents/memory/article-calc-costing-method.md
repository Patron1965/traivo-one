---
name: Artikelkalkyl kostnads-/prisläge
description: Regeln för artiklars självkostnad/prissättning och legacy-bakåtkompat
---

# Artikelkalkyl (kostnadskalkyl → självkostnad → priskalkyl)

Regel: ALL självkostnad/marginal för artiklar går via den delade motorn i den delade
prismodulen — server OCH klient (KPI:er, prisupplösning, orderkoncepts sidofält/preview/
expansion inklusive no-customer-fallbacks). Läs aldrig internkostnadskolumnen direkt som
"kostnad" och duplicera aldrig regeln i SQL.

- Kostnadsläge ej satt = LEGACY: typ-styrd bas (vara→inköpspris, annars standardkostnad)
  + additiva tillägg — befintliga artiklar ändrar inte effektiv kostnad förrän användaren
  aktivt väljer läge.
- Kalkyl-läget summerar kostnadskomponenter inkl. auto-tidskostnad (produktionstid/60 ×
  timkostnad); standardkostnad ingår ALDRIG där. Standard-läget = fast värde som ersätter
  kalkylen helt.
- Prissättning: påslag = ×(1+p%), marginal = ÷(1−m%) (företagsekonomiskt OLIKA begrepp);
  manuell = baklängesräkning av TB/marginal. Vid påslag/marginal persisteras det beräknade
  listpriset. Listpris får ALDRIG ingå i självkostnaden.

**Varning:** internkostnadskolumnen är dubbel-semantisk — öre/km resp. öre/min för
restid-/interntidsartiklar (veckoplanmotorn). De läsningarna ska INTE gå via motorn.

**Why:** kostnadsdefinitionen har driftat flera gånger (KPI-SQL, koncept-fallbacks,
wizard-sidofältet) när konsumenter läste kostnadskolumnen direkt.
**How to apply:** Ny kostnadskonsument ⇒ importera resolvern från den delade prismodulen.
