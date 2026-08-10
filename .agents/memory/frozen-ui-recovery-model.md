---
name: Frozen-UI recovery model
description: Cache-/återhämtningsprincipen som förhindrar "fryst tills omladdning" — vad varje ny realtidskonsument/publik sida måste följa.
---

Princip: query-datan cachas för evigt (`staleTime: Infinity`, ingen fokus-refetch) — invalidation via realtidshändelser är ENDA färskhetskällan. Därför måste varje väg som kan tystna ha en återhämtningsmekanism, annars fryser UI:t tills omladdning.

**Regler för nya realtidskonsumenter (audita `rg "new WebSocket" client/src` vid ändringar):**
- Hämta färsk engångstoken per (åter)anslutningsförsök; anslut aldrig tokenlöst (servern avvisar).
- Exponentiell backoff med tak; nollställ vid lyckad anslutning.
- Vid återanslutning efter avbrott (hadConnection-guard): anropa den delade reconnect-refetchen så aktiva queries kommer ikapp.
- Teardown: nolla handlers + sätt stopp-flagga FÖRE close, annars återupplivar onclose anslutningen efter unmount.

**Regler för nya publika/egna-auth-sidor:** lägg till pathen i exempt-listan för den globala 401→login-redirecten i queryClient, annars skickas besökare till Replit-inloggningen. `useAuth` använder on401:returnNull och triggar den aldrig (medvetet).

**Why:** aug 2026 — användare fick "frusna funktioner" när WS dog tyst/sessionen gick ut; två WS-konsumenter anslöt dessutom tokenlöst och var permanent döda.
