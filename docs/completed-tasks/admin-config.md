# Administration & Konfiguration

## Task #31 — Åtkomstkontroll & Inbjudningssystem
**Status:** MERGED | **Datum:** 2026-03-19

Åtkomstkontroll som blockerar obehöriga användare och inbjudningssystem för att förhandsgodkänna nya användare med rolluppsättning.

**Nyckelresultat:**
- AccessDeniedPage för ej behöriga användare
- Automatisk rolltilldelning vid matchande inbjudan
- Admin CRUD för inbjudningar i UserManagementPage
- `accessGranted`-flagga baserad på tenant-rollcheck

---

## Task #27 — Kom igång-guide för pilotkund
**Status:** MERGED | **Datum:** 2026-03-18

Steg-för-steg onboarding-upplevelse för nya användare med guidat flöde genom grundläggande setup.

**Nyckelresultat:**
- Interaktiv onboarding-wizard
- Progressindikator med tydliga steg
- Förenklad navigering under onboarding

---

## Task #30 — Branded Demo Experience
**Status:** MERGED | **Datum:** 2026-03-18

Snabb branding-redigerare för säljdemos. Admin kan konfigurera företagsnamn, logotyp, tagline och färgpalett. Auto-scrape av prospektwebbplatser.

**Nyckelresultat:**
- Varumärke-tab i Företagsinställningar
- Auto-scrape: extraherar loggor, färger och namn från URL
- Live preview av splash screen och TopNav
- WelcomeSplash och TopNav reflekterar tenant-branding

---

## Task #29 — Login Welcome Splash Screen
**Status:** MERGED | **Datum:** 2026-03-18

Animerad fullskärms-välkomstskärm som spelas vid inloggning för en "wow"-upplevelse.

**Nyckelresultat:**
- Animerad splash med Traivo-branding
- Tenant-anpassad splash vid konfigurerad branding
- Smooth övergång till dashboard

---

## Task #36 — PDF-rapport: Årsplanering — funktionsöversikt
**Status:** MERGED | **Datum:** 2026-03-19

Professionell A4 PDF-rapport som sammanfattar Årsplanering-modulens kapacitet. Genereras via script med jsPDF.

**Nyckelresultat:**
- A4-format med Traivo-branding
- Svenska tecken (Latin-1 kodning)
- Grafiska checkmarks i sammanfattningstabell
- Script: `scripts/generate-annual-planning-report.mjs`

---

## Task #15 — Buggfix: Lås-knappen fungerar inte
**Status:** MERGED | **Datum:** 2026-03-14

Lås-knappen i orderlagret (OrderStockPage) gav felmeddelande. PATCH-request nådde aldrig servern.

**Nyckelresultat:**
- Fixad route-ordning så PATCH-endpoint nås korrekt
- Verifierad lås/upplås-funktionalitet
