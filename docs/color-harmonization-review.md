# Färgharmoniseringsgenomgång — Traivo-paletten

Datum: 2026-05-06
Granskare: Task #404

## Bakgrund

Bulkomskrivningen av Tailwind-färger till Traivo-paletten flyttade alla
varningstillstånd (amber/orange/yellow) till `chart-3`/`chart-4`. `chart-4`
är dock Mountain Gray (`209 14% 48%` ljust / `209 14% 55%` mörkt) — en
neutral blågrå nyans som inte signalerar "varning" tillräckligt starkt
mot bakgrunden av Arctic Ice / Midnight Navy.

## Beslut: ny `--warning`-token

En egen `--warning`-token har lagts till i `client/src/index.css` och
exponerats i `tailwind.config.ts` som färgklassen `warning`:

| Läge  | HSL              | Ungefärlig färg      |
| ----- | ---------------- | -------------------- |
| Ljust | `32 80% 44%`     | Varm bärnsten/orange |
| Mörkt | `36 85% 56%`     | Ljus bärnsten        |

`--warning-foreground` sätts till nästan vit i ljust läge och nästan
svart i mörkt läge så att text på fyllda warning-bakgrunder behåller
AA-kontrast.

Tonen är vald för att harmonisera med Northern Teal / Aurora Green
(varma motvikter i en kall Nordic-palett) utan att kollidera med
`destructive` (mättad röd) eller `chart-3` (Arctic Mint).

## Migrerade vyer (chart-4 → warning)

Migrering har gjorts där `chart-4` tidigare bar varningssemantik
(AlertTriangle, "tight/snart/överbokar", SLA-varningar, dubbletter,
fel, kapacitet > 85%, blockerande tillstånd som inte är hårda).

- `client/src/components/WeekPlanner.tsx`
- `client/src/components/weekplanner/*` (WeekGridView, DayTimelineView,
  JobCard, JobCardExpandPanel, UnscheduledSidebar, MonthView,
  WhatIfPreview, DisruptionPanel, DndComponents, PlannerToolbar,
  PlannerDialogs, ResourceDetailSheet, usePlannerData, types)
- `client/src/components/SlaRiskPanel.tsx`
- `client/src/components/UrgentJobDialog.tsx`
- `client/src/components/ScheduleDiffView.tsx`
- `client/src/components/SigningValidationModal.tsx`
- `client/src/components/TaskDependenciesView.tsx`
- `client/src/components/Dashboard.tsx`
- `client/src/components/FocusMode.tsx`
- `client/src/components/SimpleFieldApp.tsx` (endast AlertTriangle/EJ OK
  /problempaneler/inspection-warning — break/Coffee/Åtkomstinformation
  behåller chart-4 som neutral kategori)
- `client/src/pages/ImportPage.tsx`
- `client/src/pages/AICommandCenterPage.tsx`
- `client/src/pages/ApiCostsDashboardPage.tsx` (endast budgetstatus
  critical/80%, ej diagram-kategorifärg)
- `client/src/pages/ControlTowerPage.tsx`
- `client/src/pages/EconomicsDashboardPage.tsx`
- `client/src/pages/ReportingDashboardPage.tsx`
- `client/src/pages/ObjectDetailPage.tsx` (endast AlertTriangle, ej
  karl-badge)
- `client/src/pages/ObjectDuplicatesPage.tsx`

## Vyer som granskats men där chart-4 medvetet behållits

`chart-4` används fortfarande som neutral, kategorisk grå för:

- **Navigationsfärg** (`client/src/lib/navItems.ts`) — kategorisk
  ikonfärg för "Ordrar"/"Admin", inte varning.
- **Hierarkiknapp "Kärl"** (`client/src/lib/status-colors.ts`,
  `client/src/pages/CustomerDetailPage.tsx`,
  `client/src/pages/ObjectDetailPage.tsx`) — kärl är en hierarkinivå,
  inte en varning.
- **Rast/Coffee** (`client/src/components/TimelineView.tsx`,
  `client/src/components/weekplanner/RouteMapView.tsx`,
  `client/src/components/SimpleFieldApp.tsx` paus-/coffee-knappar) —
  paus är inte en varning utan ett neutralt tillstånd.
- **Diagramkategorifärg** (`client/src/pages/ApiCostsDashboardPage.tsx`
  `hsl(var(--chart-4))` för Geoapify-serien och färgskalan) — diagrammen
  behöver fortfarande fem distinkta kategorifärger.
- **Arkitekturdiagram** (`client/src/pages/architecture.tsx`) —
  kategorisk färgkodning av lager.
- **AssignmentsPage / WorkflowGuidePage / TourGuide** — kategoriska
  färger snarare än varningar.

## Visuell genomgång (manuell, mockup-läge)

Eftersom appen kräver inloggning kunde live-screenshots inte tas i
denna körning. Manuell genomgång har gjorts genom att läsa
användningarna kring varje varningskontext och bekräfta att den nya
`warning`-tonen är semantiskt rätt:

- **WeekPlanner**: Tight-bricka, capacity > 85%, SLA-varning,
  drag-conflict (klustermatchning), dolt-av-filter-rad, "Saknar team"
  och Snart-bricka använder nu varm bärnsten — tydligt åtskild från
  destructive (röd) och primary (deep ocean blue).
- **Dashboard**: warning-borders och AlertCircle-/Clock-indikatorer
  använder warning-tonen.
- **ImportPage**: dubbletträkningar, fel-räknare, AlertTriangle-paneler
  och uppdaterade-kolumner får tydligare gul/orange-betoning.
- **FocusMode / SimpleFieldApp**: "Pågår"-status, EJ OK och
  Problem-knappen lyser tydligt; rast/Coffee förblir neutralt grå för
  att signalera att det inte är ett feltillstånd.
- **ObjectDetail / CustomerDetail**: kärlbrickor förblir i mountain
  gray (kategori), medan AlertTriangle på "Saknar kundkoppling" nu är
  varm bärnsten.

I både ljust och mörkt läge har den nya tonen tillräcklig kontrast mot
`background` (Arctic Ice respektive Midnight Navy) — i mörkt läge är
tonen ljusare/mättad (`36 85% 56%`) för att hålla samma upplevda
intensitet som i ljust läge (`32 80% 44%`).

## Riktlinje framåt

- Använd `text-warning` / `bg-warning/N` / `border-warning/N` för
  varningstillstånd (tight, snart, överbokar, SLA-warning, soft-block,
  fel-räknare, dubbletter, EJ OK).
- Använd `text-destructive` / `bg-destructive/N` för kritiska
  hård-blocker, överbelastning och fel.
- Använd `text-chart-4` / `bg-chart-4/N` endast för neutrala
  kategoriska användningar (kärl, rast, diagramfärg, navigation).
