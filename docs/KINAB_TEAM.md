# Kinab — Aktuell personal i Plannix

Denna lista speglar tenanten `kinab` i Plannix och uppdateras manuellt när nya
medlemmar bjuds in. Inbjudningar skickas av Anna (owner) från
**Inställningar → Användarhantering → Inbjudningar**.

Inbjudna användare hamnar automatiskt i Kinab vid första Replit Auth-login —
ingen manuell SQL behövs (se `processInvitations` i
`server/replit_integrations/auth/storage.ts`).

## Aktiva medlemmar

| Namn              | E-post                       | Roll  |
|-------------------|------------------------------|-------|
| Anna Andersson    | anna@kinab.se                | Owner |
| Patrik Rosengren  | patrik.rosengren@kinab.se    | Admin |

## Lägga till fler

1. Anna loggar in och går till **Användarhantering → Inbjudningar →
   Skicka inbjudan**, anger e-post och väljer roll (admin / planner /
   technician).
2. Inbjudan skickas via e-post (Resend) och syns i listan med status
   `pending`.
3. När personen loggar in via Replit Auth med samma e-postadress kopplas
   kontot automatiskt till Kinab med vald roll och inbjudan markeras som
   `used`.

Uppdatera tabellen ovan manuellt när nya medlemmar tillkommer.
