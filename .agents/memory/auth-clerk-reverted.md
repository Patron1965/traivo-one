---
name: Clerk-migrering reverterad
description: Webbinloggningen är åter Replit Auth + magiska länkar; Clerk-migreringen reverterades 2026-08-10.
---

# Clerk reverterad → Replit Auth gäller

- 2026-08-10: Clerk-migreringen reverterades på användarens begäran (git revert av migrerings-committen). Webbinloggning = Replit Auth (OIDC) + magiska e-postlänkar; mobil PIN och kundportal oförändrade.
- **Why:** produkten skulle demo:as innan Clerks DNS-poster för traivo.se hunnit på plats; Google-inloggning i prod var blockerad av DNS-propagering.
- CLERK_*-secrets finns kvar i workspace men används inte av koden — rör dem inte, och återuppfinn inte Clerk-wiring utifrån dem.
- `requireMember` i tenant-middleware överlevde reverten medvetet (Task #1443-behörigheter).
- Vid ev. ny Clerk-migrering: kör den via clerk-auth-skillens isolerade task-flöde, aldrig inline.
