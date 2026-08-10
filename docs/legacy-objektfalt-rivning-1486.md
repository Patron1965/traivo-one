# Rivning av legacy-objektfälten (contract-fas, Task #1486)

Datum: 2026-08-10

Metadata (katalogfälten **Objekttyp** och **Anläggningstyp** i systemområdet
Klassificering) är enda källan för objektklassificering. Kolumnerna
`objects.object_type`, `objects.hierarchy_level`, `objects.object_level` samt
de döda kolumnerna `objects.article_id` och `objects.last_service_date` är
borttagna ur schema, API-svar, TS-typer, importmappningar, seeds och testdata.

## Backfill-verifiering (steg 1)

- **Dev:** 503 aktiva objekt. 16 saknade metadata (samtliga i `klass-*`
  test-fixture-tenants). Åtgärdat 2026-08-10 via `ensureSystemomradenFalt` +
  `backfillClassificationMetadata` för alla 35 tenants (32 rader skapade,
  0 fel). Efterkontroll: 0 objekt med kolumnvärde utan metadata-rad.
- **Prod-replika:** 923 objekt. Katalogfälten Objekttyp/Anläggningstyp finns
  **inte** i prod ännu (publicerad app föregår expand-fasen #1484) — ingen
  backfill möjlig från dev-sidan (prod är read-only härifrån).
  904/923 rader bär enbart kolumn-DEFAULTS (`omrade`/`fastighet`/1) = ingen
  information. De 19 raderna med icke-default-värden är dokumenterade nedan
  och utgörs av demo-/testdata (kinab-demo `obj-1..8` + OBJ-010/013/014, samt
  `oqfc-*`/`eres-*`/`test-tenant-b` testtenants).
- `article_id` och `last_service_date`: **0 icke-NULL-rader i både dev och
  prod** → konstaterat döda, droppas utan ersättning.

### Prod-rader med icke-default klassificering (snapshot 2026-08-10)

| tenant | objekt | object_type | hierarchy_level |
|---|---|---|---|
| kinab | OBJ-001 Stensätravägen 2 - Soprum A | rum | rum |
| kinab | OBJ-002 Oxbacksleden 12 - Fastighet | fastighet | fastighet |
| kinab | OBJ-003 Strandvägen 15 - Kärl 240L | karl | karl |
| kinab | OBJ-004 Strandvägen 17 - Soprum | rum | rum |
| kinab | OBJ-005 Torekällbergets Skola | fastighet | fastighet |
| kinab | OBJ-006 Brunnsängsparken - Container | karl | karl |
| kinab | OBJ-007 Järnagatan 4 - Tvättstuga | rum | rum |
| kinab | OBJ-008 Turingegatan 10 - Källare | rum | rum |
| kinab | OBJ-010 BRF Hönshuset 1 | fastighet | fastighet |
| kinab | OBJ-013/OBJ-014 Avfallskärl | fastighet | fastighet |
| oqfc-1783428932231/-46619 (test) | OBJ-001..003 ×2 | karl | fastighet |
| eres-/test-tenant-b (test) | 2 rader | karl/container | karl/fastighet |

## Prod-utrullningsplan (steg 5)

Schema når prod **enbart via Publish** (aldrig startup-DDL). Vid nästa Publish:

1. Publish applicerar schema-diffen → kolumnerna droppas i prod.
2. Nya appen startar → `ensureSystemomradenFalt` etablerar katalogfälten
   Objekttyp/Anläggningstyp för alla tenants.
3. Kolumnvärdena ovan går förlorade i och med droppen — acceptabelt: 904/923 är
   rena defaults och de 19 övriga är demo-/testdata, snapshottade i tabellen
   ovan för manuell återinmatning i kinab-demon vid behov (metadata-fälten,
   Objekt 360 → Klassificering).
4. Verifiera efter publish mot prod-replikan att kolumnerna är borta och att
   `metadata_katalog` innehåller Objekttyp/Anläggningstyp per tenant.

Dev/task-miljöer: migration `migrations/0151_drop_objects_legacy_classification.sql`
(idempotent `DROP COLUMN IF EXISTS`) körs via post-merge-replay-listan.

## Post-publish-verifiering (Task #1502, 2026-08-10)

Verifierat mot prod-replikan efter Publish:

- Kolumnerna `object_type`/`hierarchy_level`/`object_level`/`article_id`/
  `last_service_date` är **borta** ur `objects` i prod.
- `metadata_katalog` innehåller aktiva Objekttyp/Anläggningstyp för **alla**
  tenants (0 tenants saknar något av fälten).
- Snapshotens kinab-demovärden (11 objekt, tabellen ovan) återinsatta som
  metadata (`metod='auto'`, `skapad_av='system'`) via
  `scripts/restore-kinab-classification-prod.ts` (dry-run + skarp körning,
  22 rader skapade, 0 hoppade). Testtenanternas rader (`oqfc-*`/`eres-*`/
  `test-tenant-b`) är testartefakter och återinsattes avsiktligt inte.

## Kodrevision A/B/C/D (steg 4)

Klassning: **A** = kärndata behålls (rätt domän, ej objects-kolumn),
**B** = objektinformation migrerad till metadata, **C** = artikel-/uppgiftsdata
i rätt domän (behålls oförändrad), **D** = död logik borttagen.

Slutrevision 2026-08-10 (grep över server/, shared/, client/src, scripts/, tests/
på objectType/object_type, hierarchyLevel/hierarchy_level, objectLevel/object_level,
lastServiceDate, facilityType samt svenska varianter):

| Område/fil(er) | Term(er) | Klass | Motivering (kort) |
|---|---|---|---|
| `server/services/object-classification.ts`, `object-metadata-sql.ts`, `server/metadata-queries.ts` | objectType, hierarchyLevel, object_type-alias | B | Klassificerings-API:t och SQL-hjälparna läser/skriver objektets egna metadata; `object_type`/`hierarchy_level` förekommer bara som alias i resultat/SQL, inte som `objects`-kolumner. |
| `server/routes/objectRoutes.ts`, `customerRoutes.ts`, `portalRoutes.ts`, `orderConceptRoutes.ts`, `aiRoutes.ts`, `mobile/shared.ts`, `objektmallImportRoutes.ts`, `fortnoxRoutes.ts`, `telephony-service.ts` | objectType, hierarchyLevel | B | Träd-, kart-, portal-, kund-, AI-, telefoni- och importflöden hämtar klassificering via metadata (`getClassificationForObjects`/`getObjectHookClassification`) eller speglingsjobb; API-fälten behålls som metadata-sourced kontrakt. |
| `server/routes/plannerRoutes.ts` | objectHierarchyLevel, lastServiceDate | A/B | `objectHierarchyLevel` härleds ur metadata; `lastServiceDate`-filtret på objekt är borttaget — kvarvarande träffar är arbetsorderdomän. |
| Klient-UI (`ObjectDetailPage`, `ObjectHeaderPanel`, objektträd, kartor, import-flöden m.fl.) | objectType, hierarchyLevel, Objekttyp | B | UI-typer representerar metadata-sourced API-svar; detaljsidan läser objektets egen Objekttyp-metadata. |
| `shared/schema.ts` + tester för object-header-konfig | objectHeaderConfigs.objectType | A | Tenant-/typbaserad admin-konfiguration, ej `objects.object_type`. |
| `server/association-service.ts`, `server/routes/mobile/misc.ts`, artikelscheman | source-literal `"object_type"`, articles.objectTypes | A/C | Regel-/artikeldata i rätt domän enligt avsiktlig modell. |
| Arbetsorder-/artikel-/feedbacktabeller | article_id, lastServiceDate | A/C | Främmande nycklar/servicedata i andra tabeller; ingen läsning av borttagna objektkolumner. |
| Import-specar, mallar, tester (`shared/import-templates.ts`, `object-import-spec.ts`, `tests/api/*`) | objekttyp/Anläggningstyp-kolumnnamn | A/B | Importkolumnnamn/alias och testkontrakt; klassificering skrivs till metadata. |

**D-överträdelser: inga.** Ingen kvarvarande aktiv logik refererar till
`objects.object_type`, `objects.hierarchy_level`, `objects.object_level`,
`objects.article_id` eller `objects.last_service_date`, och ingen död fallback finns kvar.

Verifiering (dev, 2026-08-10): legacy-kolumner i DB = 0; aktiva objekt utan
Objekttyp-metadata = 0; `schema-drift` ✓; `typecheck` 0 fel; `tests/api/object-classification.test.ts` 10/10 gröna.
