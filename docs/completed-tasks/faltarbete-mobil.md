# Fältarbete & Mobil

## Task #6 — Utföranderoller / Resursprofiler
**Status:** MERGED | **Datum:** 2026-03-12

Profilsystem för resurser med utförandekoder, utrustningstyper, kostnadsställe, projektkod och serviceområden. Används i auto-planering för kapacitetsmatchning.

**Nyckelresultat:**
- Resursprofil-schema med tillhörande CRUD
- Admin-UI i Företagsinställningar
- WeekPlanner-integration för kapacitetsmatchning
- Koppling till utförandekoder

---

## Task #7 — Snöret — Arbetspass, tidsposter & löneunderlag
**Status:** MERGED | **Datum:** 2026-03-13

Komplett arbetspassystem med check-in/check-out, tidsposter per typ (arbetstid, körtid, rast), veckosammanställning, regelbrott-detektion och löneunderlag-CSV.

**Nyckelresultat:**
- WorkSession med check-in/check-out per team
- WorkEntry med tidstyper (arbetstid, körtid, rast, övertid)
- Veckosammanställning med regelbrott-varningar
- Payroll CSV-export
- Sida: `/work-sessions`

---

## Task #23 — Rutt-feedback — förare betygsätter dagens rutt
**Status:** MERGED | **Datum:** 2026-03-17

Förare kan betygsätta och ge feedback på dagens rutt efter avslutat arbetspass. Feedbacken visas för planeraren som beslutsunderlag.

**Nyckelresultat:**
- Daglig ruttbetygsättning (1-5 stjärnor)
- Orsakskategorier och fritextfeedback
- Rapporterings-UI med KPI-kort och diagram
- AI field assistant-verktyg för feedback-analys

---

## Task #13 — Rollförtydligande — kund & anmälarroller
**Status:** MERGED | **Datum:** 2026-03-13

Formella roller för "kund" och "anmälare" i rollsystemet. Tydligare ansvarsfördelning mellan olika aktörer i systemet.

**Nyckelresultat:**
- Customer och Reporter roller
- Uppdaterat rollbaserat navigeringsfilter
- Förbättrad behörighetshantering
