# Kinab Pilot — Module Configuration (Task #526)

Denna doc beskriver vilka moduler som är aktiva för Kinab under pilotfasen och hur platform-owner aktiverar fler moduler när Kinab är mogen.

## Pilot-paket — `packageTier = "pilot"`

`pilot`-tier (definierad i `shared/modules.ts → PACKAGE_DEFINITIONS.pilot`) består av:

| Modul | Innehåll |
|---|---|
| `core` | Objekt, kunder-via-objekt-vyn, kluster, resurser, artiklar, prislistor, veckoplanering, ruttplanering, orderstock, tilldelningar, kontrollpanel, enhetsansvarig, ruttoptimering, abonnemang, planner-map, historisk karta, kategorier/metadata, planeringsparametrar |
| `customer_mgmt` | Kundregister-sida, ny-kund-wizard, dataimport |
| `kpi_analytics` | KPI-dashboard, ekonomi, rapportcentral, veckomötesrapport, proaktiv försäljning |
| `work_sessions` | Arbetspass / tidrapportering (krävs för mobilen) |
| `inspections` | Besiktningsmallar + protokoll |
| `sms` | SMS-utskick (ETA, påminnelser) |

## Vad ligger UTANFÖR pilot (dolt i UI + grindat i backend)

| Modul | Sidor/funktioner som doldas |
|---|---|
| `iot` | `/iot`, automatisk ordergenerering från sensorer |
| `ai_planning` | `/ai-assistant`, `/predictive-planning`, `/ai-command-center`, `/ml-data-quality` |
| `predictive` | `/predictive-maintenance` |
| `invoicing` | `/invoicing`, `/fortnox`, Fortnox-export-knappar |
| `customer_portal` | `/customer-portal`, `/portal-messages`, `/booking-slots`, `/customer-reports` |
| `fleet` | `/fleet`, `/vehicles` (fordonsöversikt) |
| `environmental` | `/environmental-certificates` |
| `annual_planning` | `/annual-planning` |
| `order_concepts` | `/order-concepts` |
| `route_feedback` | `/route-feedback` |
| `equipment_sharing` | `/equipment-sharing` |
| `roi_reports` | `/roi-report` (intern) + portalens ROI-vy |
| `procurements` | `/procurements` |

## Hur grindarna fungerar

### Frontend
- `FeatureProvider` hämtar `/api/tenant/features` och exponerar `isNavItemEnabled(url)` + `isModuleEnabled(key)`.
- `TopNav`, `AppSidebar`, `MobileNav`, `FloatingActionButton` och `CommandPalette` filtrerar alla menyposter genom `isNavItemEnabled` — döljs inte bara från sidofältet utan även från Cmd+K och snabbåtgärdsmenyn.
- Routes mappas till moduler via base-path (första segmentet). Routes som inte hör till någon modul lämnas alltid synliga (det är default-fallback i `getModuleForUrl`).

### Backend
- `server/feature-flags.ts` — `moduleGuardMiddleware` körs på `/api/*` och stoppar anrop till moduler tenant inte har aktiva.
- `API_MODULE_PREFIXES` mappar API-prefix till modul (t.ex. `/api/fortnox` → `invoicing`, `/api/ai` + `/api/ml/` → `ai_planning`, `/api/predictive` → `predictive`, `/api/procurements` → `procurements`).
- **404 i stället för 403** för de mest känsliga icke-pilot-modulerna — `invoicing`, `predictive`, `ai_planning` — så att existensen av endpointen inte avslöjas (`HIDE_AS_404_MODULES`).
- Övriga moduler returnerar `403 { module, message }`.
- `GUARD_SKIP_PREFIXES` (`/api/portal`, `/api/mobile`, `/api/planner`, `/api/admin`, `/api/auth`) går förbi modul-grinden — dessa har egna auth-modeller och bör grindas explicit per route där behov finns.

## Aktivera Kinab-pilot — initialt setup

Görs automatiskt av `server/seed.ts → ensureKinabPilotFeatures()` vid app-start:

- Om `tenant_features`-rad saknas för `kinab` → infogas som `pilot`.
- Om rad finns på `basic` eller `standard` (system-default) → uppgraderas till `pilot`.
- Om admin manuellt valt `custom`/`premium`/`pilot` → lämnas i fred (ingen revert).
- Varje ändring loggas i `feature_audit_log` med `changedBy = "system"`.

## Lägg till en modul när Kinab är mogen

Tre alternativ — välj efter vad som passar bäst:

**1. Via UI (rekommenderat — kräver admin/owner)**
- Logga in som `owner` eller `admin` på Kinab-tenanten.
- Gå till `/tenant-config` → Moduler.
- Aktivera modulen → tier sätts automatiskt till `custom`.

**2. Via API (platform-owner-script)**
```bash
curl -X PATCH https://app.example.com/api/tenant/features \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"enabledModules":["core","customer_mgmt","kpi_analytics","work_sessions","inspections","sms","invoicing"]}'
```
- Lämna `enabledModules` komplett (det blir den nya sanningen).
- `core` injiceras automatiskt om det inte är med.
- Sätter tier till `custom`.

**3. Via SQL (last resort, t.ex. om UI är trasigt)**
```sql
UPDATE tenant_features
SET package_tier = 'custom',
    enabled_modules = ARRAY['core','customer_mgmt','kpi_analytics','work_sessions',
                            'inspections','sms','invoicing']::text[],
    updated_at = NOW(),
    updated_by = 'platform-owner-manual'
WHERE tenant_id = 'kinab';
```
- Cache-TTL för `getTenantFeatures` är 60 s — användare ser ändringen efter ≤1 minut, eller direkt om de loggar ut/in.

## Promotera till `standard`/`premium` när allt är "go"

När Kinab vill ha hela paketet:
```bash
curl -X PATCH https://app.example.com/api/tenant/features \
  -H "Cookie: $SESSION_COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"packageTier":"standard"}'
```
- `standard` och `premium` är fördefinierade i `PACKAGE_DEFINITIONS` — modul-listan resolveras automatiskt.
- `premium` aktiverar samtliga `MODULE_KEYS` (auto-uppdateras när nya moduler läggs till).

## Audit-trail

Alla module-ändringar (UI, API, seed) loggas i `feature_audit_log` med:
- `previous_tier` → `new_tier`
- `previous_modules` → `new_modules`
- `changed_by` (user-id eller `"system"`)
- `created_at`

Hämtas via `GET /api/tenant/features/audit` (admin/owner).
