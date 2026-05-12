# Admin/överlappande sidkluster — beslutsmatris (Task #451)

## Sammanfattning

Sidkluster som granskades för möjlig sammanslagning eller arkivering:

| Sida | Storlek | Beslut |
| --- | --- | --- |
| `MetadataPage.tsx` | 393 rader | **Arkiverad.** `/metadata` redirectar till `/metadata-settings`. |
| `MetadataSettingsPage.tsx` | 592 rader | **Behåll.** Är redan kanonisk i nav. |
| `PitchPage.tsx` | 594 rader | **Arkiverad.** `/pitch` redirectar till `/investor-pitch`. |
| `InvestorPitchPage.tsx` | 1311 rader | **Behåll.** Interaktiv slide-deck + PDF-export. |
| `SystemDashboardPage.tsx` | 1208 rader | **Behåll.** Distinkt ansvar (se nedan). |
| `SystemOverviewPage.tsx` | 517 rader | **Behåll.** Distinkt ansvar (se nedan). |
| `TenantConfigPage.tsx` | 167 rader (+ tabs) | **Behåll.** Distinkt ansvar (se nedan). |

## Varför `SystemDashboard` / `SystemOverview` / `TenantConfig` förblir separata

De delar yt-likheter ("admin-aktiga sidor") men har olika domäner och olika
användare. Sammanslagning skulle skapa en mega-sida som blandar tre olika
ansvarsområden.

### `SystemDashboardPage` (`/system-dashboard`)
- **Ansvar:** Plattform-/tenant-administration: branding, modul-aktivering,
  rollhantering för användare i tenant, audit-logg, system-flaggor.
- **Mutationer:** Skriver mot `/api/tenant/branding`, `/api/tenants/:id/modules`,
  `/api/users/:id/role`, audit-endpoints.
- **Målgrupp:** Tenant-admin/owner.
- **Behållen separat:** Det är en operativ kontrollpanel med skarpa mutationer —
  inte en konfigurations-form och inte en dokumentationsvy.

### `SystemOverviewPage` (`/system-overview`)
- **Ansvar:** Statisk feature-katalog (read-only). Renderar grupperade listor
  av plattformens funktioner och kan exportera dem som PDF för intern
  dokumentation/sälj-stöd.
- **Mutationer:** Inga.
- **Målgrupp:** Onboarding, säljmaterial, intern referens.
- **Behållen separat:** En read-only docs/PDF-vy ska inte blandas med skarp
  admin-funktionalitet i `SystemDashboard`. Kan på sikt flyttas till `/docs/`
  men är inte i scope för Task #451.

### `TenantConfigPage` (`/tenant-config`)
- **Ansvar:** Tenant-konfigurationsgrunddata via tab-arkitektur — företagsinfo,
  artiklar, prislistor, resurser, resurs-profiler, team-medlemmar, IoT,
  terminologi, branding, moduler, metadata-etiketter. Rena konfig-formulär.
- **Mutationer:** Skriver mot tenant-egna konfig-tabeller via tabs.
- **Målgrupp:** Onboarding/setup-användare och tenant-admin.
- **Behållen separat:** Är en formulär-driven konfigurations-yta, inte en
  kontroll-/övervakningspanel.

### Gränssnitts-uppföljning

Eftersom de tre sidorna har distinkt ansvar men nuvarande nav-titlar
("Admin", "Systemöversikt", "Företagsinställningar") inte gör skillnaden
självklar för slutanvändaren, har en separat follow-up (#453) skapats för
att tydliggöra nav-rubriker/beskrivningar. Det är ren UX-förbättring och
ligger utanför detta tasks scope.

## Inline-pekare

Varje behållen sida har en kort doc-comment överst i filen som pekar
till detta dokument.
