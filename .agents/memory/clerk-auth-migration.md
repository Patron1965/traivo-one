---
name: Auth-arkitekturens durabla beslut
description: Beslut och säkerhetsinvarianter för autentisering (Clerk webb, mobil PIN, portal)
---

# Auth-arkitekturens durabla beslut

- Clerk är enda webbinloggningsvägen; mobil fältapp (PIN) och kundportalen är avsiktligt separata flöden. **Why:** fältpersonal saknar ofta e-post; portalen är kundvänd.
- Lokal identitet är kanonisk: Clerks konto bär bara en pekare till det lokala ID:t. Lita aldrig på session-token-claims för identitet/e-post — resolva via Clerks server-API, och använd ENBART verifierade e-postadresser för kontolänkning och inbjudningskonsumtion. **Why:** claims kräver dashboard-konfig och ovärifierade adresser är angriparstyrda.
- Inbjudningar konsumeras fail-closed: tvetydighet (samma e-post pending i flera tenants) ger ingen roll alls. **Why:** annars kan en admin i en tenant hänga på medlemskap vid inloggning avsedd för en annan tenant.
- Avstängning sker i själva provisioneringen (täcker alla request-vägar) och speglas till Clerk (ban/unban). **Why:** en lokal flagga återkallar inte en levande extern session.
- Routes utanför den globala tenant-middlewaren måste själva resolva sessionen; pre-auth endpoints får aldrig använda tenant-fallback — härled tenant ur den matchade entiteten och neka tvetydiga cross-tenant-träffar.
- Admin skapar aldrig lokala konton med lösenord: inbjudan + roll vid första inloggning.
- Frontend-SDK:t pekar i produktion deterministiskt (i koden) på serverns Clerk-proxy. **Why:** custom-domän-deployar kräver proxyn; en glömd env-var får inte tyst byta till direkt-API.
