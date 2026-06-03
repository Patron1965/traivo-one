---
name: Replit Auth login i Workspace-preview (cross-site iframe)
description: Varför Replit OIDC-login failar i den inbäddade förhandsvisningen och hur man får den att fungera.
---

# Replit Auth-login i den inbäddade Workspace-förhandsvisningen

Den inbäddade Workspace-previewen kör appen i en **cross-site iframe** (app-origin =
`*.worf.replit.dev`, topp-ram = `replit.com`). Det ger två separata fel:

1. **Session-cookien skickas aldrig i previewen.** Default `SameSite=Lax` blockeras i
   tredjeparts-iframe → `/api/auth/user` ger alltid 401, användaren ser sig som utloggad.
2. **OIDC-redirecten kan inte renderas inramad.** Klickar man login navigeras iframen till
   `replit.com/oidc`, som vägrar framing och visar Replits generiska "We encountered an
   error … Return to home"-sida.

**Why:** Detta är en plattformsbegränsning för inbäddade previews, inte en app-bugg. I
produktion (eget domännamn, ej inramad) fungerar login normalt.

**How to apply:**
- Session-cookie: sätt `sameSite: "none"` i dev/preview och `"lax"` i produktion
  (`secure: true` krävs för None). Vidga aldrig till None i prod — det ökar CSRF-ytan.
- Login-trigger: bryt ut ur iframen. Hjälpare `goToLogin()` i `client/src/lib/auth-utils.ts`
  öppnar `/api/login` i ny topp-nivå-flik (fallback `window.top.location`, sen in-iframe).
  Använd den överallt istället för rå `window.location.href = "/api/login"`.
- `returnTo` måste valideras same-origin (börjar med `/`, ej `//`) både klient och server
  för att undvika open redirect.
- E-post-magic-link fungerar däremot inuti previewen (ingen replit.com-redirect).
