# IoT & Automation

## Task #10 — IoT-API & automatisk ordergenerering
**Status:** MERGED | **Datum:** 2026-03-13

Dedikerat IoT-API som tar emot statusmeddelanden från smarta enheter (fulla kärl, trasig dörr, lågt batteri) och automatiskt genererar arbetsordrar.

**Nyckelresultat:**
- REST API för IoT-signalmottagning (`POST /api/iot/signals`)
- IoT-enhetshantering med API-nycklar
- Automatisk ordergenerering vid actionable signals (full, damaged, overflow)
- Admin-dashboard för IoT-enheter och signalhistorik

---

## Task #8 — Utrustningsdelning & skiftkollisionskontroll
**Status:** MERGED | **Datum:** 2026-03-13

Bokningskollisionskontroll för utrustning som delas mellan team vid skiftarbete, med automatisk frigöring.

**Nyckelresultat:**
- Fordonsbokningar per dag med serviceområdeszoner
- Kollisionsdetektering vid schemaläggning
- Automatisk frigöring vid arbetspassavslut
- Tillgänglighetstidslinje

---

## Task #11 — SlotPreference — fördelaktiga/ofördelaktiga tider
**Status:** MERGED | **Datum:** 2026-03-13

Enhetlig SlotPreference-vy per objekt med tidsrestriktioner och nya "fördelaktiga tider" som påverkar auto-planering.

**Nyckelresultat:**
- Preference- och reason-fält på tidsrestriktioner
- Visualiserings-UI med aggregerade preferenser
- Integration med auto-planering och WeekPlanner
