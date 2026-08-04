---
name: Objektvinjett snabbfälts-fallback & bildhistorik
description: Durabla regler för vinjettens snabbfälts-fallback, metadata-audit-attribution och bildhistorik över arv
---

- Snabbfälts-fallbackens prioritet: explicit konfig (objektkedja, sedan objekttyp) vinner ALLTID över katalogflaggan "Visa i objektvinjett". **Why:** en tom explicit konfig är ett medvetet val och får inte fyllas på av flaggade fält.
- Katalogflaggor måste vara skrivbara på ALLA katalog-skrivytor (`/api/metadata/types` OCH `/api/metadata-labels`) — en flagga som bara ena ytan accepterar blir en osättbar återvändsgränd. **How to apply:** ny katalog-boolean ⇒ uppdatera båda zod-schemana.
- Audit-attribution i metadata-mutationer är server-auktoritativ: inloggad användare vinner över klient-skickat skapadAv/uppdateradAv (klientfältet bara fallback för skriptade anrop utan session). Lita aldrig på klient-actor.
- Bildhistorik över arv: när ett lokalt värde skuggar ett ärvt startar den lokala raden en NY historikkedja — källobjektets kedja måste hämtas/visas separat (entry exponerar källradens id), annars "försvinner" historiken vid åsidosättning.
