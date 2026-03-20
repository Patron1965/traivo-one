# Planering & Schemaläggning

## Task #3 — Dashboard & UX — klickbara diagram, ruttjämförelse, väderpåverkan
**Status:** MERGED | **Datum:** 2026-03-11

Dashboard-diagram gjordes klickbara, ruttoptimeringen fick jämförelsevy, och väderdata integrerades i tidsberäkningar.

**Nyckelresultat:**
- Interaktiva Recharts-diagram med drill-down
- Ruttjämförelse före/efter optimering
- Väderpåverkan på tidsestimering (Open-Meteo)

---

## Task #33 — Årsplanering — Kalendervy med 12-månadersöversikt
**Status:** MERGED | **Datum:** 2026-03-19

Grundsida `/annual-planning` med 12-månadersöversikt som visar planerade, utförda och kvarvarande arbeten per månad.

**Nyckelresultat:**
- 12-månaders kalenderrutnät
- Färgkodade statusindikationer per månad
- Filter på kund/objekt/artikeltyp
- Responsiv design för platta och desktop

---

## Task #34 — Årsplanering — Årsmål & Uppföljning per kund/objekt
**Status:** MERGED | **Datum:** 2026-03-19

Planerare kan definiera årsmål per kund/objekt (t.ex. "12 tömningar/år") och följa upp progress med visuella indikatorer.

**Nyckelresultat:**
- `annual_goals` tabell med CRUD-endpoints
- Auto-generering från abonnemang och orderkoncept
- Progressbars med prognos-ikoner (grön/gul/röd)
- Filter, sök, sortering och varningsflik

---

## Task #4 — Orderkoncept-wizard & Kundportal
**Status:** MERGED | **Datum:** 2026-03-11

Förbättrad 9-stegs orderkoncept-guide med bättre validering och kundportal med konfigurerbara bokningsalternativ.

**Nyckelresultat:**
- "Fortsätt där du slutade"-funktion
- Stegvalidering med tydlig feedback
- Konfigurerbara självbokningsalternativ
- Dynamisk kundportal-widget

---

## Task #12 — Kundidentifiering — customerMode i orderkoncept
**Status:** MERGED | **Datum:** 2026-03-13

Explicit `customerMode`-fält (HARDCODED/FROM_METADATA) i orderkoncept-schemat för flexibel kundidentifiering.

**Nyckelresultat:**
- customerMode-val i orderkoncept-wizard
- Automatisk kunduppslagning från metadata
- Stöd för hårdkodad kundkoppling
