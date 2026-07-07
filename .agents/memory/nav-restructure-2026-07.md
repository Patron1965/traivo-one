---
name: Nav-omstrukturering (2026-07)
description: Produktbeslut bakom den stora navigeringsomläggningen — vad som medvetet dolts/behållits och varför, så framtida agenter inte "återställer" dött-ser-ut-men-är-parkerat.
---

# Navigeringsomläggning — beslut (2026-07)

Stor meny-omläggning av huvudnavigeringen. Följande är PRODUKTBESLUT (ej härledbara ur koden), som framtida arbete ska vara konsekvent med.

## Dashboard borttagen (permanent)
Dashboard-sidan + dess komponenter + `/api/dashboard/*`-endpoints är helt raderade. "Idag" (`/`) är startsidan. Återinför inte en dashboard utan explicit begäran.

## Rapporter = dolda ur menyn, INTE döda
Rapport-/analys-/försäljningssidorna (`/economics`, `/reporting`, `/weekly-report`, `/missade-jobb`, `/roi-report`, `/proactive-sales`) är borttagna ur Ekonomi-menyn men **routes + sidor finns kvar** (nås via URL/CommandPalette).
**Why:** De ska ersättas av en filterstyrd Excel-export från Grovplaneringen (exportera urval av uppgifter med informationspaket + status → användaren bygger egna rapporter i Excel). Det är ett eget större bygge tillsammans med Grovplanerings-filterbiblioteket.
**How to apply:** Behandla dem inte som dead code; ta inte bort dem. När Grovplanerings-exporten byggts kan de fasas ut.

## Ekonomi-menyn = Fortnox/ekonomisystem-meny
Ekonomi-menyn innehåller nu: Fakturering (Fakturering, Fakturakö, Omräkningslogg) + Register kopplade till Fortnox (Kundregister `/customers`, Artikelregister `/articles`, Prislistor `/price-lists`).
**Why:** Menyn ska samla det som rör kopplingen till ekonomisystemet (Fortnox API).
**How to apply:** Kundregister/Artikelregister/Prislistor ligger MEDVETET i BÅDE Grunddata och Ekonomi (användarens "också" = duplicering OK). Flytta inte ut dem ur Grunddata utan att fråga.

## AI-menyn behålls (parkerad)
AI-menyn (AI-Assistent, Prediktiv Planering, Prediktivt Underhåll) står kvar trots att den inte används aktivt än.
**Why:** AI ska framåt driva de 9 motorerna + rollbaserad fråga-på-objekt (användare/planerare/utförare/kund frågar om objekt de är kopplade till utifrån metadata + kopplade uppgifter och deras status). Eget större framtida bygge.
**How to apply:** Ta inte bort AI-menyn; bygg inte Q&A-modulen utan explicit uppdrag.

## Snabborder
Ny sida `/snabborder` (i Ordrar-menyn): objektsök → `SnabborderDialog`. Objektsök via custom queryFn (encodeURIComponent, svarsform `{objects,total}`).
