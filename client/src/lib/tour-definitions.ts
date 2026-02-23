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
      target: '[data-testid="nav-dropdown-analys"]',
      title: "Fleethantering",
      description: "Under Analys > Fleethantering kan du följa fordon, bränsleförbrukning och underhållsplanering.",
      placement: "bottom",
    },
  ],
};

export const allTours: TourDefinition[] = [
  platformTour,
  plannerTour,
  clusterTour,
  invoicingTour,
];
