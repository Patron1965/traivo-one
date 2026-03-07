# Unicorn - Systemdokumentation

*Senast uppdaterad: 2026-02-21*

## Innehållsförteckning

1. [Översikt](#översikt)
2. [Teknisk Arkitektur](#teknisk-arkitektur)
3. [Databasschema](#databasschema)
4. [API-Endpoints](#api-endpoints)
5. [Frontend-Sidor](#frontend-sidor)
6. [Komponenter](#komponenter)
7. [AI-Funktioner](#ai-funktioner)
8. [Integrationer](#integrationer)
9. [Mobilapp](#mobilapp)
10. [Systemfunktioner](#systemfunktioner)

---

## Översikt

Unicorn är en AI-driven planeringsplattform för fältserviceföretag på den nordiska marknaden, utvecklad i samarbete med Kinab AB. Plattformen fokuserar på:

- **Ruttoptimering** - Optimera körvägar för fältpersonal
- **Resursplanering** - Hantera personal, fordon och utrustning
- **Ekonomisk kontroll** - Prissättning, kostnader och fakturering
- **Produktivitetsförbättringar** - Analysera ställtider och effektivitet
- **Prediktiv analys** - AI-drivna insikter och förslag

### Målgrupp
- Avfallshantering och sophämtning (primärt)
- Alla typer av fältserviceföretag i Norden

---

## Teknisk Arkitektur

### Stack
| Komponent | Teknologi |
|-----------|-----------|
| **Frontend** | React 18, TypeScript, Vite |
| **Backend** | Express.js, Node.js |
| **Databas** | PostgreSQL (Neon) |
| **ORM** | Drizzle ORM |
| **UI-bibliotek** | shadcn/ui, Tailwind CSS |
| **State Management** | TanStack Query (React Query v5) |
| **Routing** | Wouter |
| **Kartor** | react-leaflet, OpenStreetMap |
| **AI** | OpenAI GPT-4o-mini via Replit Integrations |

### Filstruktur
```
├── client/                 # Frontend
│   ├── src/
│   │   ├── components/     # React-komponenter
│   │   ├── hooks/          # Custom hooks
│   │   ├── lib/            # Hjälpfunktioner
│   │   └── pages/          # Sidkomponenter
├── server/                 # Backend
│   ├── routes.ts           # API-routes
│   ├── storage.ts          # Databaslager
│   ├── notifications.ts    # WebSocket-notifikationer
│   └── index.ts            # Server entry point
├── shared/                 # Delad kod
│   └── schema.ts           # Drizzle schema & typer
└── docs/                   # Dokumentation
```

---

## Databasschema

### Huvudtabeller (84 tabeller totalt)

#### tenants - Hyresgäster/Organisationer
Multi-tenant arkitektur för SaaS-stöd.
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | varchar (PK) | Unikt ID |
| name | text | Organisationsnamn |
| orgNumber | text | Organisationsnummer |
| contactEmail | text | Kontakt-e-post |
| contactPhone | text | Kontakttelefon |
| settings | jsonb | Inställningar |
| createdAt | timestamp | Skapad |
| deletedAt | timestamp | Soft delete |

#### sessions - Användarsessioner
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| sid | varchar (PK) | Session-ID |
| sess | jsonb | Sessionsdata |
| expire | timestamp | Utgångsdatum |

#### users - Användare
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | varchar (PK) | Unikt ID |
| email | varchar (unique) | E-post |
| firstName | varchar | Förnamn |
| lastName | varchar | Efternamn |
| profileImageUrl | varchar | Profilbild |
| passwordHash | varchar | Lösenordshash |
| createdAt | timestamp | Skapad |
| updatedAt | timestamp | Uppdaterad |

#### customers - Slutkunder
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | varchar (PK) | Unikt ID |
| tenantId | varchar (FK) | Tenant |
| name | text | Kundnamn |
| customerNumber | text | Kundnummer |
| contactPerson | text | Kontaktperson |
| email | text | E-post |
| phone | text | Telefon |
| address | text | Adress |
| city | text | Stad |
| postalCode | text | Postnummer |
| notes | text | Anteckningar |
| createdAt | timestamp | Skapad |
| deletedAt | timestamp | Soft delete |

#### objects - Serviceobjekt
Fysiska platser där service utförs - hierarkisk struktur (Område → Fastighet → Rum).
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | varchar (PK) | Unikt ID |
| tenantId | varchar (FK) | Tenant |
| customerId | varchar (FK) | Kund |
| clusterId | varchar | Kluster |
| parentId | varchar (FK) | Förälderobjekt |
| name | text | Namn |
| objectNumber | text | Objektnummer |
| objectType | text | Typ (område/fastighet/rum) |
| objectLevel | integer | Nivå (1-3) |
| address | text | Adress |
| city | text | Stad |
| postalCode | text | Postnummer |
| latitude | real | Latitud |
| longitude | real | Longitud |
| accessType | text | Åtkomsttyp |
| accessCode | text | Portkod |
| keyNumber | text | Nyckelnummer |
| accessInfo | jsonb | Åtkomstinfo |
| preferredTime1 | text | Föredragen tid 1 |
| preferredTime2 | text | Föredragen tid 2 |
| containerCount | integer | Antal kärl |
| containerCountK2 | integer | Antal kärl K2 |
| containerCountK3 | integer | Antal kärl K3 |
| containerCountK4 | integer | Antal kärl K4 |
| servicePeriods | jsonb | Serviceperioder |
| avgSetupTime | integer | Snitt ställtid |
| status | text | Status |
| notes | text | Anteckningar |
| lastServiceDate | timestamp | Senaste service |
| createdAt | timestamp | Skapad |
| deletedAt | timestamp | Soft delete |

#### resources - Resurser/Personal
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | varchar (PK) | Unikt ID |
| tenantId | varchar (FK) | Tenant |
| userId | varchar (FK) | Kopplad användare |
| name | text | Namn |
| initials | text | Initialer |
| resourceType | text | Typ (person/team) |
| phone | text | Telefon |
| email | text | E-post |
| pin | text | PIN för mobilapp |
| homeLocation | text | Hemadress |
| homeLatitude | real | Latitud |
| homeLongitude | real | Longitud |
| weeklyHours | integer | Veckotimmar |
| competencies | text[] | Kompetenser |
| availability | jsonb | Tillgänglighet |
| serviceArea | text[] | Serviceområde |
| efficiencyFactor | real | Effektivitet (1.0 = normal) |
| drivingFactor | real | Körtempo (1.0 = normal) |
| costCenter | text | Kostnadsställe |
| projectCode | text | Projektkod |
| status | text | Status |
| createdAt | timestamp | Skapad |
| deletedAt | timestamp | Soft delete |

#### workOrders - Arbetsordrar
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | varchar (PK) | Unikt ID |
| tenantId | varchar (FK) | Tenant |
| customerId | varchar (FK) | Kund |
| objectId | varchar (FK) | Objekt |
| clusterId | varchar | Kluster |
| resourceId | varchar (FK) | Resurs |
| teamId | varchar (FK) | Team |
| title | text | Titel |
| description | text | Beskrivning |
| orderType | text | Typ (service/felanmalan/etc) |
| priority | text | Prioritet |
| status | text | Legacy-status |
| orderStatus | text | Modus-status |
| scheduledDate | timestamp | Planerat datum |
| scheduledStartTime | text | Planerad starttid |
| plannedWindowStart | timestamp | Tidsfönster start |
| plannedWindowEnd | timestamp | Tidsfönster slut |
| estimatedDuration | integer | Beräknad tid (min) |
| actualDuration | integer | Faktisk tid (min) |
| setupTime | integer | Ställtid |
| setupReason | text | Ställtidsanledning |
| lockedAt | timestamp | Låst |
| completedAt | timestamp | Slutförd |
| invoicedAt | timestamp | Fakturerad |
| cachedValue | integer | Cachedat värde |
| cachedCost | integer | Cachad kostnad |
| cachedProductionMinutes | integer | Cachad produktionstid |
| isSimulated | boolean | Simulerad |
| simulationScenarioId | varchar (FK) | Scenario |
| plannedBy | varchar | Planerad av |
| plannedNotes | text | Planeringsanteckningar |
| notes | text | Anteckningar |
| metadata | jsonb | Metadata |
| createdAt | timestamp | Skapad |
| deletedAt | timestamp | Soft delete |

#### workOrderLines - Orderrader
| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | varchar (PK) | Unikt ID |
| tenantId | varchar (FK) | Tenant |
| workOrderId | varchar (FK) | Order |
| articleId | varchar (FK) | Artikel |
| quantity | integer | Antal |
| resolvedPrice | integer | Beräknat pris |
| resolvedCost | integer | Beräknad kostnad |
| resolvedProductionMinutes | integer | Produktionstid |
| priceListIdUsed | varchar (FK) | Prislista |
| priceSource | varchar | Priskälla |
| discountPercent | integer | Rabatt % |
| isOptional | boolean | Valfri |
| notes | text | Anteckningar |
| createdAt | timestamp | Skapad |

### Stödtabeller

| Tabell | Beskrivning |
|--------|-------------|
| simulationScenarios | Scenarion för what-if-analys |
| setupTimeLogs | Loggade ställtider |
| articles | Artiklar/tjänster/varor |
| priceLists | Prislistor (generell, kundunik, rabattbrev) |
| priceListArticles | Artikelpriser per prislista |
| vehicles | Fordon |
| equipment | Utrustning |
| resourceVehicles | Resurs ↔ fordon-koppling |
| resourceEquipment | Resurs ↔ utrustning-koppling |
| resourceAvailability | Tillgänglighetsscheman |
| vehicleSchedule | Fordonsscheman |
| subscriptions | Prenumerationer |
| clusters | Geografiska kluster |
| teams | Arbetslag |
| teamMembers | Teammedlemskap |
| planningParameters | SLA-nivåer och regler |
| resourceArticles | Resurskompetenser per resurs |
| procurements | Upphandlingar |

### System/Admin-tabeller

| Tabell | Beskrivning |
|--------|-------------|
| brandingTemplates | Branschmallar för white-labeling |
| tenantBranding | Per-tenant varumärkeskonfiguration |
| userTenantRoles | Roller och behörigheter |
| auditLogs | Revisionsloggar |
| conversations | AI-konversationshistorik |
| messages | AI-meddelanden |

---

## API-Endpoints

### MCP (Model Context Protocol)
```
GET    /mcp/sse                            - SSE-anslutning för externa AI
POST   /mcp/messages                       - Meddelanden till MCP
```

### Kunder
```
GET    /api/customers                      - Lista alla kunder
GET    /api/customers/:id                  - Hämta specifik kund
POST   /api/customers                      - Skapa kund
PATCH  /api/customers/:id                  - Uppdatera kund
DELETE /api/customers/:id                  - Ta bort kund
```

### Objekt
```
GET    /api/objects                        - Lista objekt (paginerat, sökbart)
GET    /api/objects/:id                    - Hämta objekt
GET    /api/customers/:customerId/objects  - Objekt per kund
POST   /api/objects                        - Skapa objekt
PATCH  /api/objects/:id                    - Uppdatera objekt
DELETE /api/objects/:id                    - Ta bort objekt
```

### Resurser
```
GET    /api/resources                      - Lista resurser
GET    /api/resources/:id                  - Hämta resurs
POST   /api/resources                      - Skapa resurs
PATCH  /api/resources/:id                  - Uppdatera resurs
DELETE /api/resources/:id                  - Ta bort resurs
```

### Arbetsordrar
```
GET    /api/work-orders                    - Lista ordrar (med filter)
GET    /api/work-orders/:id                - Hämta order
GET    /api/resources/:resourceId/work-orders - Ordrar per resurs
POST   /api/work-orders                    - Skapa order
PATCH  /api/work-orders/:id                - Uppdatera order
DELETE /api/work-orders/:id                - Ta bort order
POST   /api/work-orders/:id/status         - Ändra orderstatus
POST   /api/work-orders/:id/promote        - Promote till skarp order
```

### Orderrader
```
GET    /api/work-orders/:workOrderId/lines - Rader för order
POST   /api/work-orders/:workOrderId/lines - Lägg till rad
PATCH  /api/work-order-lines/:id           - Uppdatera rad
DELETE /api/work-order-lines/:id           - Ta bort rad
```

### Orderstock
```
GET    /api/order-stock                    - Aggregerad ordervy med filter
```

### Simulering
```
GET    /api/simulation-scenarios           - Lista scenarier
GET    /api/simulation-scenarios/:id       - Hämta scenario
POST   /api/simulation-scenarios           - Skapa scenario
PATCH  /api/simulation-scenarios/:id       - Uppdatera scenario
DELETE /api/simulation-scenarios/:id       - Ta bort scenario
POST   /api/simulation-scenarios/:id/clone-orders - Klona ordrar
```

### Ställtider
```
POST   /api/setup-time-logs                - Logga ställtid
GET    /api/setup-time-logs                - Hämta loggade ställtider
```

### Upphandlingar
```
GET    /api/procurements                   - Lista upphandlingar
GET    /api/procurements/:id               - Hämta upphandling
POST   /api/procurements                   - Skapa upphandling
PATCH  /api/procurements/:id               - Uppdatera upphandling
DELETE /api/procurements/:id               - Ta bort upphandling
```

### Import
```
POST   /api/import/customers               - Importera kunder (CSV)
POST   /api/import/resources               - Importera resurser (CSV)
POST   /api/import/objects                 - Importera objekt (CSV)
POST   /api/import/modus/objects           - Modus objektimport
POST   /api/import/modus/tasks             - Modus uppgiftsimport
POST   /api/import/modus/events            - Modus händelseimport
DELETE /api/import/clear/:type             - Rensa importerad data
```

### Export
```
GET    /api/export/:type                   - Exportera data (CSV)
```

### Tenant
```
GET    /api/tenant/settings                - Hämta tenant-inställningar
PATCH  /api/tenant/settings                - Uppdatera tenant-inställningar
```

### Artiklar
```
GET    /api/articles                       - Lista artiklar
GET    /api/articles/:id                   - Hämta artikel
POST   /api/articles                       - Skapa artikel
PATCH  /api/articles/:id                   - Uppdatera artikel
DELETE /api/articles/:id                   - Ta bort artikel
```

### Prislistor
```
GET    /api/price-lists                    - Lista prislistor
GET    /api/price-lists/:id                - Hämta prislista
POST   /api/price-lists                    - Skapa prislista
PATCH  /api/price-lists/:id                - Uppdatera prislista
DELETE /api/price-lists/:id                - Ta bort prislista
GET    /api/price-lists/:priceListId/articles - Artiklar i prislista
POST   /api/price-lists/:priceListId/articles - Lägg till artikel
PATCH  /api/price-list-articles/:id        - Uppdatera prislistartikel
DELETE /api/price-list-articles/:id        - Ta bort prislistartikel
GET    /api/resolve-price                  - Beräkna pris (hierarki)
```

### Resurskompetenser
```
GET    /api/resources/:resourceId/articles - Artiklar för resurs
POST   /api/resources/:resourceId/articles - Lägg till artikel
PATCH  /api/resource-articles/:id          - Uppdatera
DELETE /api/resource-articles/:id          - Ta bort
```

### Fordon
```
GET    /api/vehicles                       - Lista fordon
GET    /api/vehicles/:id                   - Hämta fordon
POST   /api/vehicles                       - Skapa fordon
PATCH  /api/vehicles/:id                   - Uppdatera fordon
DELETE /api/vehicles/:id                   - Ta bort fordon
```

### Utrustning
```
GET    /api/equipment                      - Lista utrustning
GET    /api/equipment/:id                  - Hämta utrustning
POST   /api/equipment                      - Skapa utrustning
PATCH  /api/equipment/:id                  - Uppdatera utrustning
DELETE /api/equipment/:id                  - Ta bort utrustning
```

### Resurs ↔ Fordon
```
GET    /api/resources/:resourceId/vehicles - Fordon för resurs
POST   /api/resources/:resourceId/vehicles - Tilldela fordon
PATCH  /api/resource-vehicles/:id          - Uppdatera
DELETE /api/resource-vehicles/:id          - Ta bort
```

### Resurs ↔ Utrustning
```
GET    /api/resources/:resourceId/equipment - Utrustning för resurs
POST   /api/resources/:resourceId/equipment - Tilldela utrustning
PATCH  /api/resource-equipment/:id         - Uppdatera
DELETE /api/resource-equipment/:id         - Ta bort
```

### Resurstillgänglighet
```
GET    /api/resource-availability/:resourceId - Tillgänglighet per resurs
GET    /api/resource-availability-item/:id    - Hämta post
POST   /api/resource-availability/:resourceId - Skapa post
PATCH  /api/resource-availability-item/:id    - Uppdatera
DELETE /api/resource-availability-item/:id    - Ta bort
```

### Fordonsschema
```
GET    /api/vehicle-schedule/:vehicleId    - Schema per fordon
GET    /api/vehicle-schedule-item/:id      - Hämta post
POST   /api/vehicle-schedule/:vehicleId    - Skapa post
PATCH  /api/vehicle-schedule-item/:id      - Uppdatera
DELETE /api/vehicle-schedule-item/:id      - Ta bort
```

### Prenumerationer
```
GET    /api/subscriptions                  - Lista prenumerationer
GET    /api/subscriptions/:id              - Hämta prenumeration
POST   /api/subscriptions                  - Skapa prenumeration
PATCH  /api/subscriptions/:id              - Uppdatera
DELETE /api/subscriptions/:id              - Ta bort
POST   /api/subscriptions/generate-orders  - Generera ordrar
```

### Kluster
```
GET    /api/clusters                       - Lista kluster
GET    /api/clusters/:id                   - Hämta kluster
POST   /api/clusters                       - Skapa kluster
PATCH  /api/clusters/:id                   - Uppdatera kluster
DELETE /api/clusters/:id                   - Ta bort kluster
GET    /api/clusters/:id/objects           - Objekt i kluster
GET    /api/clusters/:id/work-orders       - Ordrar i kluster
GET    /api/clusters/:id/subscriptions     - Prenumerationer i kluster
POST   /api/clusters/:id/refresh-cache     - Uppdatera klustercache
```

### AI-Endpoints
```
POST   /api/ai/chat                        - Generell AI-chatt
POST   /api/ai/field-assistant             - Fältarbetarassistent
POST   /api/ai/planning-suggestions        - Planeringsförslag
POST   /api/ai/auto-schedule               - Automatisk schemaläggning
POST   /api/ai/auto-schedule/apply         - Applicera AI-schema
POST   /api/ai/optimize-routes             - Ruttoptimering
POST   /api/ai/workload-analysis           - Arbetsbelastningsanalys
GET    /api/ai/setup-insights              - Ställtidsinsikter
POST   /api/ai/apply-setup-updates         - Applicera ställtidsuppdateringar
GET    /api/ai/predictive-planning         - Prediktiv planering
GET    /api/ai/auto-cluster                - AI-klusterförslag
POST   /api/ai/auto-cluster/apply          - Applicera AI-kluster
```

### Väder
```
GET    /api/weather/forecast               - Väderprognos
GET    /api/weather/cluster/:clusterId     - Väder per kluster
```

### Rutter
```
POST   /api/routes/directions              - Körriktningar (ORS proxy)
POST   /api/routes/optimize                - Optimera rutt (ORS proxy)
```

### Notifikationer
```
POST   /api/notifications/token            - Hämta WebSocket-token
```

### Mobil API (PIN-baserad)
```
POST   /api/mobile/login                   - Inloggning (email + PIN)
POST   /api/mobile/logout                  - Utloggning
GET    /api/mobile/me                      - Inloggad resurs
GET    /api/mobile/my-orders               - Mina ordrar
GET    /api/mobile/orders/:id              - Orderdetaljer
PATCH  /api/mobile/orders/:id/status       - Uppdatera status
POST   /api/mobile/orders/:id/notes        - Lägg till anteckning
POST   /api/mobile/position                - Rapportera GPS-position
```

### Fältarbetare Task API (tenant-auth)
```
GET    /api/field-worker/tasks             - Uppgifter med beroendeinfo (?date=X&resourceId=Y)
POST   /api/field-worker/tasks/:id/start   - Starta uppgift (sätter travel-status)
POST   /api/field-worker/tasks/:id/complete - Slutför uppgift (löser beroendekedjor)
POST   /api/field-worker/tasks/:id/update-metadata - Skriv metadata till objekt
POST   /api/field-worker/tasks/:id/upload-photo    - Hämta presigned URL för foto
POST   /api/field-worker/tasks/:id/confirm-photo   - Bekräfta fotouppladdning
```

### Orderkoncept
```
GET    /api/order-concepts                 - Lista orderkoncept
POST   /api/order-concepts                 - Skapa orderkoncept
GET    /api/order-concepts/:id             - Hämta orderkoncept
PUT    /api/order-concepts/:id             - Uppdatera orderkoncept
DELETE /api/order-concepts/:id             - Ta bort orderkoncept
GET    /api/order-concepts/:id/preview     - Förhandsgranska genererade ordrar
POST   /api/order-concepts/:id/run-rolling - Kör rullande förlängning
POST   /api/order-concepts/:id/rerun       - Kör om med ändringsdetektering
GET    /api/order-concept-run-logs         - Körningshistorik
GET    /api/subscription-changes           - Lista abonnemangsändringar
PATCH  /api/subscription-changes/:id       - Godkänn/avvisa ändring
```

### Beroende-mallar
```
GET    /api/task-dependency-templates      - Lista beroendemallar
POST   /api/task-dependency-templates      - Skapa beroendemall
```

### Fakturaregler & Fakturering
```
GET    /api/invoice-rules                  - Lista fakturaregler
POST   /api/invoice-rules                  - Skapa fakturaregel
GET    /api/invoice-preview                - Generera fakturaförhandsvisning
POST   /api/invoice-preview/export-to-fortnox - Exportera till Fortnox
```

### Besiktning (Inspection)
```
GET    /api/inspection-metadata            - Hämta besiktningsdata (?objectId=X)
POST   /api/inspection-metadata            - Spara besiktningsresultat
GET    /api/inspection-metadata/search     - Sök besiktningar (?inspectionType=X&status=Y)
```

### Autentisering
```
GET    /api/auth/user                      - Hämta inloggad användare
```

### System Dashboard
```
GET    /api/system/branding-templates      - Lista branschmallar
GET    /api/system/branding-templates/:id  - Hämta mall
GET    /api/system/branding-templates/slug/:slug - Hämta via slug
```

---

## Frontend-Sidor

### Alla registrerade routes (45+ sidor)

| Route | Sida | Beskrivning |
|-------|------|-------------|
| `/` | MyTasksPage | Mina uppgifter (startsida) |
| `/home` | MyTasksPage | Alias för startsida |
| `/planner` | WeekPlannerPage | Veckoplanerare |
| `/week-planner` | WeekPlannerPage | Alias för veckoplanerare |
| `/clusters` | ClustersPage | Klusterhantering |
| `/clusters/:id` | ClusterDetailPage | Klusterdetaljer |
| `/routes` | RoutesPage | Ruttvisualisering |
| `/optimization` | OptimizationPrepPage | Optimeringsförberedelse |
| `/objects` | ObjectsPage | Objekthantering |
| `/resources` | ResourcesPage | Resurshantering |
| `/procurements` | ProcurementsPage | Upphandlingar |
| `/articles` | ArticlesPage | Artikelkatalog |
| `/price-lists` | PriceListsPage | Prislistor |
| `/order-stock` | OrderStockPage | Orderstock |
| `/vehicles` | VehiclesPage | Fordonsflotta |
| `/subscriptions` | SubscriptionsPage | Prenumerationer |
| `/planning-parameters` | PlanningParametersPage | Planeringsparametrar |
| `/dashboard` | DashboardPage | Dashboard/översikt |
| `/economics` | EconomicsDashboardPage | Ekonomisk översikt |
| `/setup-analysis` | SetupTimeAnalysisPage | Ställtidsanalys |
| `/predictive-planning` | PredictivePlanningPage | Prediktiv planering |
| `/auto-cluster` | AutoClusterPage | AI-klusterförslag |
| `/weather` | WeatherPlanningPage | Väderplanering |
| `/customer-portal` | CustomerPortalPage | Kundportal |
| `/portal-messages` | PortalMessagesPage | Portalmeddelanden |
| `/import` | ImportPage | Dataimport |
| `/system-overview` | SystemOverviewPage | Systemöversikt |
| `/settings` | SettingsPage | Inställningar |
| `/system-dashboard` | SystemDashboardPage | White-labeling & admin |
| `/industry-packages` | IndustryPackagesPage | Branschpaket |
| `/mobile` | MobileFieldPage | Mobilvy för fältarbetare |
| `/field` | MobileFieldPage | Alias för mobilvy |
| `/simple` | MobileFieldPage | Alias för mobilvy |
| `/project-report` | ProjectReportPage | Projektrapport |
| `/metadata` | MetadataPage | Metadata-hantering |
| `/metadata-settings` | MetadataSettingsPage | Metadata-inställningar |
| `/fortnox` | FortnoxSettingsPage | Fortnox-integration |
| `/sms-settings` | SmsSettingsPage | SMS-inställningar |
| `/api-costs` | ApiCostsDashboardPage | API-kostnader |
| `/environmental-certificates` | EnvironmentalCertificatePage | Miljöcertifikat |
| `/architecture` | ArchitecturePage | Arkitekturöversikt |
| `/order-concepts` | OrderConceptsPage | Orderkoncept (Avrop/Schema/Abonnemang) |
| `/assignments` | AssignmentsPage | Uppdrag |
| `/ai-assistant` | AIAssistantPage | AI-assistent |
| `/reporting` | ReportingDashboardPage | Rapportering |
| `/workflow-guide` | WorkflowGuidePage | Arbetsflödesguide |
| `/data-requirements` | DataRequirementsPage | Datakrav |
| `/inspections` | InspectionSearchPage | Besiktningssökning |
| `/ai-planning` | AIPlanningPage | AI-planering |
| `/pitch` | PitchPage | Pitch-presentation |
| `/investor-pitch` | InvestorPitchPage | Investerarpitch |
| `/lundstams-roi` | LundstamsROIPage | Lundstams ROI-analys |

#### Kundportal-routes (separat router)
| Route | Sida | Beskrivning |
|-------|------|-------------|
| `/portal` | PortalLoginPage | Portalinloggning (magic link) |
| `/portal/verify` | PortalVerifyPage | Verifiera magic link |
| `/portal/dashboard` | PortalDashboardPage | Kundöversikt |
| `/portal/clusters` | PortalClusterOverviewPage | Klusteröversikt |
| `/portal/invoices` | PortalInvoicesPage | Fakturor |
| `/portal/contracts` | PortalContractsPage | Kontrakt |
| `/portal/settings` | PortalSettingsPage | Inställningar |
| `/portal/issues` | PortalIssuesPage | Felanmälan |

---

## Komponenter

### Layout-komponenter
| Komponent | Fil | Beskrivning |
|-----------|-----|-------------|
| TopNav | `layout/TopNav.tsx` | Horisontell navigation med dropdowns |
| MobileNav | `layout/MobileNav.tsx` | Mobilmeny (hamburger) |
| FloatingActionButton | `layout/FloatingActionButton.tsx` | Snabbåtgärder |
| QuickStats | `layout/QuickStats.tsx` | Dashboard-kort |
| AppSidebar | `layout/AppSidebar.tsx` | Sidopanel (legacy) |

### Kärnkomponenter
| Komponent | Fil | Beskrivning |
|-----------|-----|-------------|
| WeekPlanner | `WeekPlanner.tsx` | Drag-and-drop veckoschema |
| RouteMap | `RouteMap.tsx` | Kartvisualisering |
| OptimizedRouteMap | `OptimizedRouteMap.tsx` | Optimerade rutter |
| ObjectCard | `ObjectCard.tsx` | Objektvisning |
| JobModal | `JobModal.tsx` | Orderdetaljer i modal |
| ResourceList | `ResourceList.tsx` | Resurslista |
| Dashboard | `Dashboard.tsx` | Huvuddashboard |
| SimpleFieldApp | `SimpleFieldApp.tsx` | Fältarbetarvy |

### AI-komponenter
| Komponent | Fil | Beskrivning |
|-----------|-----|-------------|
| AICard | `AICard.tsx` | Kompakt AI-panel |
| AISuggestionsPanel | `AISuggestionsPanel.tsx` | Fullständig AI-panel |
| GlobalAIButton | `GlobalAIButton.tsx` | Flytande AI-knapp |
| FieldAIAssistant | `FieldAIAssistant.tsx` | AI för fältarbetare |

### Hjälpkomponenter
| Komponent | Fil | Beskrivning |
|-----------|-----|-------------|
| AddressSearch | `AddressSearch.tsx` | Adressautokomplettering |
| ObjectUploader | `ObjectUploader.tsx` | Filuppladdning |
| ThemeToggle | `ThemeToggle.tsx` | Dark/light mode |
| ErrorBoundary | `ErrorBoundary.tsx` | Felhantering |
| TenantBrandingProvider | `TenantBrandingProvider.tsx` | White-label theming |

---

## AI-Funktioner

### Implementerade AI-endpoints

| Endpoint | Beskrivning |
|----------|-------------|
| `/api/ai/chat` | Generell AI-chatt för frågor om systemet |
| `/api/ai/field-assistant` | AI-assistent för fältarbetare |
| `/api/ai/planning-suggestions` | Analysera veckoplanering och ge förslag |
| `/api/ai/auto-schedule` | Automatisk schemaläggning |
| `/api/ai/auto-schedule/apply` | Applicera AI-genererat schema |
| `/api/ai/optimize-routes` | Förslag på ruttförbättringar |
| `/api/ai/workload-analysis` | Identifiera överbelastning |
| `/api/ai/setup-insights` | Analysera ställtider |
| `/api/ai/apply-setup-updates` | Uppdatera objektens ställtider |
| `/api/ai/predictive-planning` | Prognoser baserat på historik |
| `/api/ai/auto-cluster` | AI-förslag på klusterbildning |
| `/api/ai/auto-cluster/apply` | Skapa kluster från AI-förslag |

### Väderintegration
Auto-schemaläggning använder Open-Meteo API för 7-dagars väderprognos och justerar:
- Kapacitet baserat på väderförhållanden (0.4-1.0 multiplikator)
- Prioritering av dagar med bra väder för utomhusarbete

### AI-teknologi
- **Provider:** OpenAI via Replit AI Integrations
- **Modeller:** gpt-4o-mini (snabba analyser), gpt-4o (komplexa beslut)

---

## Integrationer

### Interna integrationer
| Integration | Beskrivning |
|-------------|-------------|
| PostgreSQL | Primär databas (Neon-hosted) |
| Drizzle ORM | Databashantering |
| OpenAI | AI-funktioner via Replit |
| Object Storage | Filuppladdning |
| Replit Auth | Användarautentisering |

### Externa API:er
| API | Användning |
|-----|------------|
| OpenRouteService | Ruttberäkning och optimering |
| OpenStreetMap Nominatim | Geokodning |
| Open-Meteo | Väderprognos |

### MCP-server (Model Context Protocol)
```
SSE endpoint:      GET  /mcp/sse
Message endpoint:  POST /mcp/messages
Header:            X-MCP-Session-Id

Resurser: work-orders, resources, clusters
Verktyg: get_work_orders, get_resources, get_clusters, schedule_work_order, get_daily_summary
```

---

## Mobilapp

### Webbvy (`/mobile`, `/field`, `/simple`)
Responsiv webbvy för fältarbetare (SimpleFieldApp) med:
- Inloggning (email + PIN)
- Dagens arbetsordrar med beroendeindikering (Låst/Upplåst)
- Starta/slutföra/avbryta uppdrag
- Tidsloggning med rast-funktion
- Lägga till anteckningar
- Navigera till adresser (Google Maps-integration)
- AI-assistent
- Realtidsnotifikationer (WebSocket)
- Fotouppladdning (presigned URL flow)
- Besiktningschecklista (6 kategorier: Dörr, Lås, Fönster, Belysning, Golv, Ventilation)
- Avvikelsehantering med orsaker och åtgärder

### Beroendehantering i mobilvy
- **Låsta uppgifter:** Rödfärgade kort med lås-ikon, kan inte startas
- **Upplåsta uppgifter:** Normala kort med öppet lås-ikon
- **Auto-upplåsning:** När föregående uppgift slutförs markeras beroendekedjor som klara

### Besiktningssystem
6 inspektionskategorier med predefined issue badges:
| Kategori | Problem-alternativ |
|----------|-------------------|
| Dörr | Knarrar, Stängs inte, Skadad, Saknar stängare |
| Lås | Slitet, Fastnar, Saknas, Fel nyckel |
| Fönster | Sprucket, Öppnas inte, Trasig spanjolette, Kondens |
| Belysning | Ur funktion, Blinkar, Saknas, Felaktig armatur |
| Golv | Skadat, Halt, Smutsigt, Sprickor |
| Ventilation | Ur funktion, Oljud, Dålig luft, Blockerad |

Varje kategori: OK / Varning / Fel status + valfri kommentar.

### Notifikationstyper
- `job_assigned` - Nytt uppdrag
- `job_updated` - Order uppdaterad
- `job_cancelled` - Order avbokad
- `schedule_changed` - Schema ändrat
- `priority_changed` - Prioritet ändrad

### Extern Fältapp-koppling
Se **MOBILE_API.md** för komplett API-dokumentation avsedd för det externa Fältapp-projektet.

---

## Systemfunktioner

### Multi-tenancy
- Data isoleras per `tenantId`
- Stöd för flera organisationer

### White-labeling (System Dashboard)
- Branschmallar
- Anpassade färger och typsnitt
- Logotyper

### Autentisering
- Replit Auth för webbapp
- PIN-baserad inloggning för mobilapp

### Orderstatus (Modus-flöde)
1. `skapad` - Order skapad
2. `planerad_pre` - Förplanerad
3. `planerad_resurs` - Resurs tilldelad
4. `planerad_las` - Låst
5. `utford` - Utförd
6. `fakturerad` - Fakturerad

---

## Orderkoncept-systemet

### Tre orderscenarier
| Scenario | Beskrivning | Fakturering |
|----------|-------------|-------------|
| **Avrop** | On-demand-beställningar | Per uppgift |
| **Schema** | Återkommande med leveransschema + tidsfönster | Per rum/område |
| **Abonnemang** | Prenumeration med månatlig avgift per enhet | Månatlig |

### Abonnemangsfält
- `washesPerYear` - Antal tvättar per år
- `pricePerUnit` - Pris per enhet (öre)
- `monthlyFee` - Månatlig avgift
- `billingFrequency` - Faktureringsfrekvens (monthly/quarterly/yearly)
- `contractLock` - Bindningstid (månader)

### Beroendemallar (Task Dependency Templates)
Artikel-till-artikel-beroenden med tre typer:
- `before` - Måste slutföras före
- `after` - Ska utföras efter
- `same_day` - Samma dag

### Körning och Ändringsdetektering
- **Rullande förlängning:** Genererar ordrar framåt baserat på leveransschema
- **Omkörning (Rerun):** Detekterar ändringar i orderkoncept och genererar diff
- **Körningsloggar:** Spårar varje körning med typ, resultat och metadata

### Fakturaregler
4 faktureringstyper:
- `per_task` - En rad per slutförd uppgift
- `per_room` - Grupperat per rum
- `per_area` - Grupperat per område
- `monthly` - Månatlig samlad

Metadata på fakturahuvud (kostnadsställe, projekt) och per rad (artikelkod, utförare).

### Fortnox Export
`POST /api/invoice-preview/export-to-fortnox` skapar FortnoxInvoiceExport-poster per orderrad med:
- `costCenter` från fakturahuvud-metadata
- `project` från fakturahuvud-metadata
- `totalAmount` beräknat per rad

---

*Dokumentet baserat på kodbas per 2026-02-21.*
