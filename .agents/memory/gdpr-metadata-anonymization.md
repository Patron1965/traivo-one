---
name: GDPR metadata-anonymisering
description: Vad anonymisering av ett metadatafält MÅSTE träffa för att GDPR-raderingen ska vara komplett, och var mirror-scrub får ligga utanför tx.
---

# GDPR-anonymisering av metadatafält (oåterkalleligt)

Anonymisering av ETT katalogfält på ett objekt måste förstöra värdet i ALLA
lagringsplatser — annars är GDPR-raderingen ofullständig:

1. `metadata_varden` — ALLA lokala rader (aktiva OCH arkiverade) för katalog+objekt: nulla alla `varde*`, sätt `status='anonymiserad'` + `anonymiseradAv/Vid`.
2. `metadata_historik` — nulla `gammalt_varde`/`nytt_varde` på befintliga rader; lägg till EN audit-rad `andringsMetod='anonymisering'` (vem/när, ALDRIG vad).
3. Uppgiftspaket-jsonb-kopior på work_orders + assignments i HELA subträdet, inkl. **frysta** uppgifter (frozen-gaten kringgås medvetet här — annars läcker frozen paket värdet).
4. Geo/task mirror-kolumner: `objects` geo-cache (address/postal_code/city; koordinater→latitude/longitude/entrance_*), WO `task_latitude/longitude`, assignments address/lat/long.

**Success-kontraktet (KRITISKT — vad som får vara best-effort):**
Primär destruktion (steg 1–2 + audit) körs i EN tx. ALLA durabla kopior som INTE byggs om automatiskt (uppgiftspaket-jsonb inkl. frysta, geo-spegelkolumner) MÅSTE lyckas som del av success — kasta vidare vid fel (→ non-200), aldrig svälj i try/catch. Endast en RENT rebuildbar projektion (rebuild av öppna uppgifters paket från nu-nullad källa) får vara best-effort.
**Why:** post-commit scrub som loggar-och-returnerar-200 skapar falsk "GDPR-radering" — personuppgifter ligger kvar i en durabel kopia medan API:t säger klart. Frysta uppgiftspaket byggs ALDRIG om → deras scrub är icke-förhandlingsbar. En retry är idempotent (primärraden finns kvar, nullad).

**How to apply:** ny lagringsplats för ett metadatavärde ⇒ lägg till den i anonymiserings-funktionen. Fältnamn-set:en matchar på katalog-NAMN i gemener.

**Lokal-only + fail-closed (KRITISKT):** anonymisering får ENDAST träffa lokala (icke-ärvda) värden. Saknas lokal `metadata_varden`-rad (t.ex. rent ärvt fält på ett barn) MÅSTE hela operationen avvisas (kasta → 409) INNAN någon audit-rad/historik-scrub/spegel-scrub körs.
**Why:** annars nullas 0 rader men audit-rad skrivs och UI rapporterar framgång → falsk "GDPR-radering" medan källvärdet ligger kvar på förälder och fortsätter ärvas nedåt. Gate:a i BÅDE UI (dölj knappen på `source==='inherited'`) OCH server (kasta vid 0 lokala rader) — UI-only räcker aldrig.

**Oåterkallelighet är ett SKRIV-kontrakt, inte bara en UI-låsning (KRITISKT):** en rad med `status='anonymiserad'` är ett terminalt tillstånd — INGEN vanlig skrivväg får återuppliva den. Den generiska uppdateringsfunktionen (`updateMetadata`, bakom `PUT /api/metadata/:id`) återställde tidigare status till `'aktiv'` villkorslöst → en helt vanlig fält-edit kunde skriva ett nytt värde OCH flippa tillbaka status = GDPR-raderingen bruten. Guard: avvisa (kasta → route 409) när befintlig rad är anonymiserad, INNAN någon skrivning. Anonymiseringens EGEN destruktion går aldrig via updateMetadata (den kör direkt `db.update`), så en blank spärr är säker.
**Why:** irreversibilitet är hela poängen med GDPR-anonymisering; en enda skrivväg som nollställer statusen gör "oåterkalleligt" till en lögn.
**How to apply:** varje NY skrivväg som kan träffa samma `(objekt, katalog)` måste antingen hoppa över anonymiserade rader (`createMetadata`/restore gör redan `status!=='aktiv' ⇒ continue` / `raderad===true`-only) eller kasta. UI måste spegla: dölj edit/delete/propagera/återställ på anonymiserade rader (server-guarden är sanningen, UI är bara bekvämlighet).

**Karusell-UI:** `visasIKarusell===false` filtrerar bort fältet från karusell-ytan (default true → äldre fält visas). `status==='anonymiserad'` ⇒ låst kort (ingen edit/delete/anonymize), "Anonymiserad"-badge, dolt värde. Anonymisera-knapp endast admin (isAdmin), på lokala icke-system-fält.

**Karusell-paritet på övriga presentationsytor:** ytor som LISTAR objekt-metadatavärden (ObjectMetadataPanel + ObjectInheritedMetadataPanel = exportförhandsgranskning/ObjectsPage-popovers) måste också honorera `visasIKarusell` (dölj tekniska fält) + visa "Anonymiserad"-status. Datan finns REDAN i `/api/metadata/objects` (`entry.status`, `entry.katalog.visasIKarusell`) — den konsumerades bara inte. Källa/arv/tid/användare-flaggor fanns sedan tidigare i de panelerna.

**visasIKarusell är en VISNINGSFLAGGA, inte en funktionsspärr (viktig gräns):** applicera den ENDAST på värde-listnings-ytor (objekt-360-karusell + export-popovers). Funktionella artikelflöden (WorkOrderMetadataPanel hämta/lämna via `/article-preview`, mobil `metadata-context`) får ALDRIG filtreras på visasIKarusell — en admin-konfigurerad hämta/lämna-kod måste fungera även om fältet är dolt i karusellen. Anonymiserade värden försvinner ändå där automatiskt eftersom läsvägen (`getArticleMetadataForObject`) filtrerar `status='aktiv'` → anonymiserade rader (status='anonymiserad') exkluderas. Admin (MetadataSettingsPage) är flaggans författare (katalog-schema, inga per-objekt-värden) → värde-karusell ej tillämplig där.
