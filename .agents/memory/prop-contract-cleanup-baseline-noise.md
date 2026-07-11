---
name: Prop-kontrakt-städning måste täcka ALLA konsumenter
description: Varför en required-prop-borttagning skeppade en runtime-krasch till prod trots tsc-fel
---

**Regel:** När en komponents prop-kontrakt ändras (props tas bort/blir required) måste ALLA konsumenter uppdateras i samma commit — och tsc-utfallet för just de rörda filerna måste verifieras explicit.

**Why:** En refaktor tog bort legacy-props ur call-siten men inte ur barnkomponenten som fortfarande läste `prop.length` på undefined → hela objektsidan kraschade i ErrorBoundary och SKEPPADES till prod. tsc flaggade felet (TS2739/TS2322) men det drunknade i repots stabila baseline-brus (se `tsc-baseline-noise.md`) — "tsc har fel ändå" maskerade en riktig shipped krasch.

**How to apply:**
- Vid kontraktsändring: grep alla användningar av komponenten + kör tsc och diffa NYA fel i rörda filer mot baseline innan leverans.
- Optional API-payload-fält (t.ex. `qfc?.source?.level`) ska optional-chainas hela vägen — ett `?.` på roten räcker inte.
- jsdom-tester som monterar hela sidan fångar denna kraschklass; stale tester mot borttagen UI ska skrivas om (inte skippas) så de fortsätter vakta.
