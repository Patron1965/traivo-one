import type { TourDefinition } from "@/hooks/use-tour";

export const platformTour: TourDefinition = {
  id: "platform-overview",
  name: "Plattformsguide",
  description: "Lär dig grunderna i Unicorn-plattformen",
  steps: [
    {
      target: '[data-testid="img-tenant-logo"], [data-testid="img-tenant-logo-fallback"]',
      title: "Välkommen till Unicorn",
      description: "Det här är din organisation. Klicka på loggan för att alltid komma tillbaka till startsidan.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Grunddata",
      description: "Här hittar du all stamdata: objekt, resurser, fordon, artiklar och kluster. Det här är grunden som allt annat bygger på.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "Planering",
      description: "Planera veckans arbete, hantera uppgifter och använd AI-assistenten för smart schemaläggning.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-analys"]',
      title: "Analys och Rapportering",
      description: "Se dashboards, ekonomiska nyckeltal, fakturering, fleethantering och miljöcertifikat.",
      placement: "bottom",
    },
    {
      target: '[data-testid="button-global-search"]',
      title: "Global sökning",
      description: "Sök snabbt efter vad som helst i systemet. Tryck Cmd+K (eller Ctrl+K) för att öppna sökningen var du än befinner dig.",
      placement: "bottom",
    },
    {
      target: '[data-testid="button-notifications"]',
      title: "Notifikationer",
      description: "Här visas aviseringar om nya händelser, avvikelser och viktiga uppdateringar i realtid.",
      placement: "bottom",
    },
    {
      target: '[data-testid="button-help"]',
      title: "Hjälp och guider",
      description: "Klicka här när som helst för att starta den här guiden igen eller se guider för specifika funktioner.",
      placement: "bottom",
    },
    {
      target: '[data-testid="button-user-menu"]',
      title: "Din profil",
      description: "Hantera dina inställningar och logga ut via din profilmeny.",
      placement: "bottom",
    },
  ],
};

export const plannerTour: TourDefinition = {
  id: "planner-guide",
  name: "Veckoplanering",
  description: "Lär dig använda veckoplaneraren",
  steps: [
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "Öppna planeringen",
      description: "Gå till Planering > Veckoplanering för att planera veckans arbete med drag-and-drop.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "AI-assistenten",
      description: "Använd AI Command Center eller AI Planeringsassistent för att få smarta förslag på schemaläggning baserat på geografisk närhet och resurstillgänglighet.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "Orderkoncept",
      description: "Skapa automatiserade orderflöden med Avrop, Schema och Abonnemang. Systemet genererar uppgifter åt dig.",
      placement: "bottom",
    },
  ],
};

export const clusterTour: TourDefinition = {
  id: "cluster-guide",
  name: "Kluster och områden",
  description: "Förstå hur kluster organiserar arbetet",
  steps: [
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Kluster",
      description: "Kluster grupperar objekt i geografiska områden. Gå till Grunddata > Kluster för att hantera dina arbetsområden.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Anpassade färger",
      description: "Varje kluster kan ha en egen färg som visas på kartor och i veckoplaneraren för enkel överblick.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Servicefrekvens",
      description: "Ställ in hur ofta objekt i klustret ska besökas och vilken tid på dagen som föredras.",
      placement: "bottom",
    },
  ],
};

export const invoicingTour: TourDefinition = {
  id: "invoicing-guide",
  name: "Fakturering",
  description: "Hantera fakturor och Fortnox-export",
  steps: [
    {
      target: '[data-testid="nav-dropdown-analys"]',
      title: "Fakturering",
      description: "Gå till Analys > Fakturering för att skapa och hantera fakturor baserat på utförda arbetsordrar.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-analys"]',
      title: "Fortnox-export",
      description: "Exportera fakturor direkt till Fortnox med ett klick. Systemet håller koll på exporthistorik och status.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Prislistor",
      description: "Hantera prislistor under Grunddata > Prislistor. Priserna kopplas till artiklar och används vid fakturaberäkning.",
      placement: "bottom",
    },
  ],
};

export const fleetTour: TourDefinition = {
  id: "fleet-guide",
  name: "Fleethantering",
  description: "Hantera fordon, underhåll och bränsle",
  steps: [
    {
      target: '[data-testid="nav-dropdown-analys"]',
      title: "Fleethantering",
      description: "Gå till Analys > Fleethantering för att få full överblick över din fordonsflotta, underhåll och bränslekostnader.",
      placement: "bottom",
    },
    {
      target: '[data-testid="card-kpi-vehicles"], [data-testid="fleet-management-page"]',
      title: "Fordonsöversikt",
      description: "Snabbkort visar antal fordon, servicevarningar, bränsle- och underhållskostnader. Klicka på ett fordon för att se detaljer.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-maintenance"], [data-testid="tabs-fleet"]',
      title: "Underhållsplanering",
      description: "Under fliken Underhåll ser du servicevarningar, underhållstyper och historik. Lägg till nya underhållsloggar direkt.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-fuel"], [data-testid="tabs-fleet"]',
      title: "Bränsleuppföljning",
      description: "Fliken Bränsle visar trenddiagram, fördelning per bränsletyp och förbrukning per fordon. Registrera tankning löpande.",
      placement: "bottom",
    },
    {
      target: '[data-testid="button-add-fuel"], [data-testid="button-add-maintenance"]',
      title: "Registrera ny post",
      description: "Använd knapparna högst upp för att snabbt lägga till bränsle- eller underhållsposter.",
      placement: "bottom",
    },
  ],
};

export const reportingTour: TourDefinition = {
  id: "reporting-guide",
  name: "Rapportering & Analys",
  description: "Utforska KPI-dashboarden och rapporter",
  steps: [
    {
      target: '[data-testid="nav-dropdown-analys"]',
      title: "Rapportering",
      description: "Gå till Analys > Rapportering & KPI för att se alla nyckeltal och trender i din verksamhet.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tabs-report-sections"], [data-testid="reporting-dashboard"]',
      title: "Sju analysflikar",
      description: "Dashboarden har flikarna Översikt, Produktivitet, Slutförda, Avvikelser, Resurser, Områden och Kunder — varje flik ger djupare insikter.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-productivity"], [data-testid="tabs-report-sections"]',
      title: "Produktivitet",
      description: "Se planerad vs faktisk tid, effektivitetstrender och resursranking. Identifiera flaskhalsar snabbt.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-deviations"], [data-testid="tabs-report-sections"]',
      title: "Avvikelser",
      description: "Följ avvikelsetrender, kategorifördelning, allvarlighetsgrad och senaste rapporterna. Fältarbetare rapporterar avvikelser direkt från appen.",
      placement: "bottom",
    },
    {
      target: '[data-testid="select-time-range"], [data-testid="button-export-report"]',
      title: "Tidsperiod och export",
      description: "Välj tidsperiod (7, 30 eller 90 dagar) och exportera rapporter vid behov.",
      placement: "bottom",
    },
  ],
};

export const teamManagementTour: TourDefinition = {
  id: "team-management-guide",
  name: "Teamhantering",
  description: "Hantera användare, roller och arbetsteam",
  steps: [
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Användarhantering",
      description: "Gå till Grunddata > Användarhantering för att skapa konton, tilldela roller och organisera team.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-users"], [data-testid="text-page-title"]',
      title: "Användare",
      description: "Under fliken Användare ser du alla konton med roll, kopplad resurs och status. Skapa nya användare med lösenord för fältappen.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-teams"], [data-testid="text-page-title"]',
      title: "Team",
      description: "Team grupperar resurser i arbetsgrupper (vanligtvis 2 personer). Tilldela ordrar till ett team så ser alla medlemmar jobben i fältappen.",
      placement: "bottom",
    },
    {
      target: '[data-testid="button-create-user"], [data-testid="text-page-title"]',
      title: "Skapa användare",
      description: "Klicka Ny användare för att skapa ett konto. Ange namn, e-post, lösenord och roll. Koppla till en resurs för att aktivera fältappen.",
      placement: "bottom",
    },
    {
      target: '[data-testid="button-create-team"], [data-testid="text-page-title"]',
      title: "Skapa team",
      description: "Klicka Nytt team för att gruppera resurser. Välj teamledare och lägg till medlemmar. Team visas med badge på arbetsorderkort i planeraren.",
      placement: "bottom",
    },
  ],
};

export const tenantConfigTour: TourDefinition = {
  id: "tenant-config-guide",
  name: "Företagskonfiguration",
  description: "Ställ in företagsuppgifter, artiklar och resurser",
  steps: [
    {
      target: '[data-testid="nav-settings-menu"], [data-testid="nav-dropdown-grunddata"]',
      title: "Tenant-konfiguration",
      description: "Gå till Inställningar för att konfigurera ditt företag. Här ställer du in allt som behövs för att komma igång.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-company"], [data-testid="input-company-name"]',
      title: "Företagsinfo",
      description: "Fyll i företagsnamn, organisationsnummer, kontaktuppgifter och bransch. Det här visas på fakturor och rapporter.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-articles"], [data-testid="input-company-name"]',
      title: "Artiklar och exekveringskoder",
      description: "Under fliken Artiklar kopplar du exekveringskoder till artiklar. Koderna styr vilka resurser som kan utföra vilka uppgifter.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-pricelists"], [data-testid="input-company-name"]',
      title: "Prislistor",
      description: "Fliken Prislistor ger överblick och länk till fullständig prislistehantering. Priserna används vid fakturering.",
      placement: "bottom",
    },
    {
      target: '[data-testid="tab-resources"], [data-testid="input-company-name"]',
      title: "Resurser och behörigheter",
      description: "Aktivera exekveringskoder per resurs. Systemet matchar automatiskt rätt resurs till rätt uppgift vid autoplanering.",
      placement: "bottom",
    },
  ],
};

export const customerPortalTour: TourDefinition = {
  id: "customer-portal-guide",
  name: "Kundportal",
  description: "Förstå kundportalen och självservice",
  steps: [
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Kundportal",
      description: "Unicorn har en kundportal där era kunder kan logga in, se besök, boka extra tjänster och chatta — utan att ringa er.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Magic Link-inloggning",
      description: "Kunder loggar in via en magic link som skickas till deras e-post. Inga lösenord behövs — säkert och enkelt.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Kommande besök",
      description: "Kunden ser sina kommande planerade besök med datum, tjänstetyp och status. Transparent service skapar förtroende.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Extra bokningar",
      description: "Kunden kan boka extra tjänster direkt i portalen genom att välja objekt, tjänst och önskat datum.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-grunddata"]',
      title: "Realtidschat",
      description: "Inbyggd chatt låter kunden kommunicera direkt med er. Meddelanden syns i plattformens meddelandevy.",
      placement: "bottom",
    },
  ],
};

export const fieldAppTour: TourDefinition = {
  id: "field-app-guide",
  name: "Fältappen",
  description: "Översikt av mobilappen för fältarbetare",
  steps: [
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "Fältappen (Driver Core)",
      description: "Fältarbetare använder en mobilapp för att se sina jobb, rapportera och kommunicera. Allt som planeras här syns direkt i appen.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "Jobbflöde",
      description: "Fältarbetaren ser dagens jobb sorterade efter prioritet. De startar, pausar och slutför jobb med enkla knappar. Statusändringen syns direkt i planeraren.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "Avvikelser och inspektion",
      description: "Fältarbetaren rapporterar avvikelser med foto och GPS direkt i appen. Inspektionschecklistor fylls i på plats — resultaten syns under Rapportering.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "Offline-stöd",
      description: "Appen fungerar utan internetanslutning. Ändringar sparas lokalt och synkas automatiskt när uppkopplingen är tillbaka.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "GPS och realtid",
      description: "Fältarbetarens position spåras i realtid och visas på kartan i plattformen. Notifieringar skickas direkt via push.",
      placement: "bottom",
    },
    {
      target: '[data-testid="nav-dropdown-planering"]',
      title: "AI-assistent i fält",
      description: "Fältarbetaren har tillgång till en AI-assistent för frågor, röstinspelning som transkriberas, och bildanalys för att identifiera avvikelser.",
      placement: "bottom",
    },
  ],
};

export const allTours: TourDefinition[] = [
  platformTour,
  plannerTour,
  clusterTour,
  invoicingTour,
  fleetTour,
  reportingTour,
  teamManagementTour,
  tenantConfigTour,
  customerPortalTour,
  fieldAppTour,
];
