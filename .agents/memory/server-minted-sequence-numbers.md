---
name: Server-myntade sekvensnummer (SO-NNN/OBJ-NNN)
description: Löpande ordernummer/objektnummer myntas server-side och måste strippas från ALLA klient-write-routes, inte bara minting-routen.
---

# Server-myntade sekvensnummer

Löpande, per-tenant sekvensnummer (t.ex. `work_orders.orderNumber` = `SO-<n>`,
objektnummer `OBJ-<n>`) myntas ALLTID server-side under advisory-lock + MAX+1,
och backas av ett partiellt unikt index per tenant.

**Regeln:** klient-skickat sekvensnummer måste strippas på VARJE route som kan
skriva kolumnen — inte bara den route som myntar. För work orders gäller det
`POST /api/work-orders/with-lines` (minting), `POST /api/work-orders` OCH
`PATCH /api/work-orders/:id`. Insert-/update-schemat (`insertWorkOrderSchema`)
omit:ar bara `id`/`createdAt`, så kolumnen är annars fritt klient-skrivbar.

**Why:** en tenant-intern användare kan annars (a) reservera/hoppa framtida
nummer genom att sätta ett högt värde (inflaterar MAX+1), eller (b) trigga
500-fel via kollision mot det unika indexet. Ingen cross-tenant-exponering
(tenantId tvingas, indexet är per-tenant) → medium, inte blockerande, men lätt
att missa eftersom bara minting-routen är uppenbar.

**How to apply:** när du inför ett nytt server-mynt-fält, gör `delete
body.<fält>` (eller `.omit()`) på samtliga create/update-routes för tabellen,
och lita på advisory-lock + unikt index som backstop. Verifiera route-ordning:
statiska hjälp-routes (t.ex. `/next-order-number`) måste registreras FÖRE
`/:id`, annars skuggas de.
