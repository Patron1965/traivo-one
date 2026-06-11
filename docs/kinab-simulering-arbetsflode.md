# KINAB – Steg-för-steg simulering av arbetsflöde & funktioner

Syfte: en körbar checklista för att gå igenom hela Traivo-flödet som KINAB-tenant –
från nollställning och datainladdning, via planering och fältexekvering, till
fakturering och Fortnox-export. Bocka av varje punkt under genomgången.

> Status-markering per steg: ✅ = klart · ⏭️ = hoppa över (ej i pilot) · ⚠️ = avvikelse noterad

---

## 0. Förberedelse & inloggning

- [ ] Bekräfta att appen kör (workflow **Start application**) och att preview öppnar.
- [ ] Logga in som KINAB-admin (Anna / Patrik). Verifiera att rätt tenant (`kinab`) är aktiv.
- [ ] Kontrollera aktiva moduler (pilot-tier): `core`, `customer_mgmt`, `kpi_analytics`,
      `work_sessions`, `inspections`, `sms`. (Avancerat: `ai_planning`, `iot`, `invoicing`
      är dolda/begränsade i piloten – markera ⏭️ där de dyker upp nedan.)
- [ ] (Vid behov ren omstart) Nollställ transaktionsdata men behåll master/config:
      `npx tsx scripts/kinab-reset-operational-data.ts --confirm RENSA-KINAB`
      → arbetsordrar/entries/protokoll rensas, artiklar/resurser/branding bevaras.

## 1. Datainladdning (master = Fortnox + Modus 2.0)

- [ ] **Kunder från Fortnox:** kör/verifiera kundsync (`/fortnox`). Fortnox äger
      org.nummer och faktureringsadress. Kontrollera att ~486 aktiva + ~1 809 vilande
      kunder finns (KINAB:s riktvärde).
- [ ] **Objekt från Modus 2.0:** gå till **Objektmall-import** (`/objektmall-import`).
      Ladda upp Excel/CSV. Förhandsgranska diff (create/update/repoint) innan commit.
- [ ] (Alt.) Generell bulk-import av kund/objekt via **Import** (`/import`).
- [ ] Bekräfta att förhandsvisningens fält-diff stämmer med vad commit skriver.

## 2. Datakvalitet

- [ ] **Saknade koordinater** (`/objects/missing-coordinates`): geokoda objekt som
      saknar GPS så de hamnar rätt på kartan (krävs för ruttoptimering).
- [ ] **Objektdubbletter** (`/objects/duplicates`): hitta och slå ihop dubbletter.
- [ ] Spot-kontrollera ett par objekt på **Planner Map** (`/planner-map`) att de ligger rätt.

## 3. Objekt & kundhierarki

- [ ] **Kunder** (`/customers`): granska kundträd (förälder/barn) och kluster.
- [ ] **Kunddetalj** (`/customers/:id`): se kundens objekt, kontakter, servicehistorik.
- [ ] **Objekt** (`/objects`): öppna ett objekt, expandera raden och kontrollera
      "Släktnamn" (hierarkiskt visningsnamn) samt primär/alternativa föräldrar.
- [ ] **Objektdetalj** (`/objects/:id`): verifiera metadata, historik och arv från
      primär förälder.

## 4. Metadata

- [ ] **Metadata-inställningar** (`/metadata-settings`): granska MetadataKatalog
      (namn + beteckning = universella nycklar för import/filter/sök).
- [ ] **Metadatadefinitioner** (`/metadata-definitions`): kontrollera fältnycklar.
- [ ] **Ordertyp-metadata** (`/order-type-metadata`): mappa vilka fält som visas per
      ordertyp.
- [ ] Testa att ett katalogfält som är "i bruk" är immutable (namnbyte blockeras 409).

## 5. Artiklar, BOM & prislistor

- [ ] **Artiklar** (`/articles`): master över tjänster/material/arbete.
- [ ] **Strukturartiklar** (`/structure-articles`): BOM – artiklar uppbyggda av
      komponenter (self-reference förbjuden: childId ≠ parentId).
- [ ] **Prislistor** (`/price-lists`): kund-/generell prissättning. Testa
      index-justering (skriver alltid över indexDate/indexPercentage med senaste värdet).
- [ ] Notera: DB-prisfält är **öre**, Fleet/Invoice-summor är **kronor** (ej utbytbara).

## 6. Orderkoncept (avtal → uppgifter)

- [ ] **Orderkoncept** (`/order-concepts`): granska tjänstemallar (artiklar + schema +
      metadatakrav).
- [ ] **Skapa nytt** via wizard (`/order-concepts/new`): bygg t.ex. "Tömning varje
      tisdag" med pris och antalslogik (`matches_field` om antal styrs av metadata).
- [ ] **Validera** konceptet – kontrollera att fakturamottagare resolvas utan konflikt
      (lika prioritet på samma nivå = blockerande ERROR).
- [ ] **Expandera** konceptet → arbetsordrar + assignments skapas (rader hamnar i
      `assignments`, inte direkt i `work_orders`).

## 7. Planering & schemaläggning

- [ ] **Order Stock** (`/order-stock`): se oschemalagda arbetsordrar som väntar.
- [ ] **WeekPlanner** (`/planner`): dra-och-släpp ordrar till team/fordon på veckotidslinjen.
- [ ] **Veckoplan** (`/veckoplan`): 168-timmarsschema per team för kapacitet.
- [ ] **Grovplanering** (`/grovplanering`): balansera kapacitet vs. efterfrågan per
      team/distrikt inkl. ordervärde.
- [ ] **Control Tower** (`/control-tower`): heatmap för beläggning och SLA-risk.
- [ ] **Enhetsansvarig** (`/enhetsansvarig`): daglig produktion, break-even, avvikelser.
- [ ] **Distrikt** (`/distrikt`): kontrollera zon-/postnummer-/polygon-uppdelning.
- [ ] **Rutter** (`/routes`) & **Årsplanering** (`/annual-planning`): återkommande
      service och säsongsvolym.
- [ ] ⏭️ Om `ai_planning` är av: hoppa över VRP/AI-ruttoptimering (pilot-begränsning).

## 8. Resurser, team & fordon

- [ ] **Resurser** (`/resources`): personal, kompetenser, tillgänglighet.
- [ ] **Team:** verifiera KINAB:s 6 team: `ADO 237`, `BHO`, `DSU`, `IFA`, `OJK-BÖ`,
      `ZML-BÖ`. Varje aktivt team behöver minst en medlem, en team-leader eller
      klusterkoppling för att kunna ruttas.
- [ ] **Fleet** (`/fleet`): fordon och underhåll.

## 9. Fältexekvering – Traivo Go (mobil)

- [ ] **Mobil hem** (`/mobile`): logga in som fälttekniker, se dagens jobb.
- [ ] **Jobbvy:** starta jobb, navigera, start/stopp-timer, bocka av checklista.
- [ ] **Focus Mode** + signaturfångst + materiallogg + jobbprotokoll.
- [ ] **Avvikelser:** rapportera "kan ej utföras" / kundändring / fel.
- [ ] **Dagsrapport** i slutet av passet.
- [ ] Verifiera att slutförda uppgifter postas tillbaka och syns i planeringen.

## 10. Arbetspass

- [ ] **Work Sessions** (`/work-sessions`): granska tidloggar, raster och aktiva pass.

## 11. Kundportal (kundens vy)

- [ ] **Portal Dashboard** (`/portal/dashboard`): status, statistik, snabbåtgärder.
- [ ] **Portal Map** (`/portal/map`): realtidsspårning av service och objektstatus.
- [ ] **Portal Issues** (`/portal/issues`): kunden skapar ett ärende → verifiera att
      det dyker upp internt.
- [ ] **Portal Invoices** (`/portal/invoices`): kunden ser/laddar ner fakturor.
- [ ] Kontrollera objekt-scope: kund med begränsad scope ser bara sina objekt.

## 12. Fakturering & konsolidering

- [ ] **Fakturering** (`/invoicing`): omvandla färdiga rapporter till fakturerbara rader.
- [ ] **Invoice Queue** (`/invoice-queue`): granska held/pending/consolidated. Testa
      manuell släpp (`requireAdmin`).
- [ ] Kontrollera frozen-priser (frozenUnitPrice används om satt) och frozen
      fakturamottagare på arbetsordern.
- [ ] **Economics** (`/economics`): intäkter, marginaler, lönsamhet.
- [ ] ⏭️ Om `invoicing`-modulen är begränsad i piloten: markera och hoppa.

## 13. Fortnox-export

- [ ] **Fortnox** (`/fortnox`): exportera validerade fakturarader till Fortnox.
- [ ] Verifiera att held arbetsordrar **refuseras** (måste släppas/vänta) och att
      orphan-mappningar städas efter lyckad export.

## 14. Admin & konfiguration

- [ ] **Tenant Config** (`/tenant-config`): branding, moduler, terminologi.
- [ ] **User Management** (`/user-management`): användare, roller, behörigheter
      (access styrs av tenant-rollen, inte legacy `users.role`).

## 15. Avslut & verifiering

- [ ] Gå tillbaka till **Today/Översikt** (`/`) och bekräfta att dagens flöde stämmer.
- [ ] Notera alla ⚠️-avvikelser med skärmdump + sida + förväntat vs. faktiskt.
- [ ] Vid ren demo-omstart: kör reset-scriptet i steg 0 igen.

---

### KINAB – snabbreferens

| Sak | Värde |
|---|---|
| Tenant-id | `kinab` |
| Paket-tier | `pilot` |
| Aktiva moduler | core, customer_mgmt, kpi_analytics, work_sessions, inspections, sms |
| Team (6 st) | ADO 237, BHO, DSU, IFA, OJK-BÖ, ZML-BÖ |
| Master för kunder | Fortnox (org.nr, faktureringsadress) |
| Master för objekt | Modus 2.0 (Excel/CSV via objektmall-import) |
| Nollställning | `npx tsx scripts/kinab-reset-operational-data.ts --confirm RENSA-KINAB` |
| Kundvolym (riktvärde) | ~486 aktiva · ~1 809 vilande |

> Tips: kör hela kedjan i ordning (0 → 15) första gången för att se helheten; därefter
> kan enskilda block (t.ex. 6–9) köras isolerat per testtillfälle.
