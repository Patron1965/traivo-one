export const MODULE_KEYS = [
  "core",
  "iot",
  "annual_planning",
  "ai_planning",
  "fleet",
  "environmental",
  "customer_portal",
  "invoicing",
  "predictive",
  "work_sessions",
  "order_concepts",
  "inspections",
  "sms",
  "route_feedback",
  "equipment_sharing",
  "roi_reports",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  description: string;
  icon: string;
  routes: string[];
  navItems?: string[];
}

export const MODULE_DEFINITIONS: Record<ModuleKey, Omit<ModuleDefinition, "key">> = {
  core: {
    label: "Grundplattform",
    description: "Objekt, resurser, kluster, ordrar, veckoplanering, ruttplanering, artiklar, prislistor",
    icon: "LayoutDashboard",
    routes: ["/", "/home", "/clusters", "/auto-cluster", "/objects", "/resources", "/articles", "/price-lists", "/planner", "/routes", "/order-stock", "/assignments", "/settings", "/dashboard", "/weather", "/reporting", "/economics", "/planner-map", "/historical-map", "/metadata", "/subscriptions"],
    navItems: [],
  },
  iot: {
    label: "IoT & Sensorer",
    description: "Sensorhantering, automatisk ordergenerering, fyllnadsnivåer",
    icon: "Wifi",
    routes: ["/iot"],
    navItems: ["/iot"],
  },
  annual_planning: {
    label: "Årsplanering",
    description: "Årsmål per kund/objekt med AI-driven distribution",
    icon: "Target",
    routes: ["/annual-planning"],
    navItems: ["/annual-planning"],
  },
  ai_planning: {
    label: "AI-planering",
    description: "AI-assistent, AI-kommandocentral, prediktiv planering",
    icon: "Brain",
    routes: ["/ai-assistant", "/ai-command-center", "/ai-planning", "/predictive-planning"],
    navItems: ["/ai-assistant", "/predictive-planning"],
  },
  fleet: {
    label: "Fleethantering",
    description: "Fordonsöversikt, underhållsplanering, bränsleuppföljning",
    icon: "Truck",
    routes: ["/fleet", "/vehicles"],
    navItems: ["/fleet", "/vehicles"],
  },
  environmental: {
    label: "Miljö & Hållbarhet",
    description: "CO2-spårning, miljöcertifikat, hållbarhetsrapporter",
    icon: "Leaf",
    routes: ["/environmental-certificates"],
    navItems: ["/environmental-certificates"],
  },
  customer_portal: {
    label: "Kundportal",
    description: "Extern kundvy med bokningar, besök och meddelanden",
    icon: "Building",
    routes: ["/customer-portal", "/portal-messages"],
    navItems: ["/customer-portal"],
  },
  invoicing: {
    label: "Fakturering",
    description: "Fakturaförhandsgranskning, Fortnox-export, exporthistorik",
    icon: "Receipt",
    routes: ["/invoicing", "/fortnox"],
    navItems: ["/invoicing"],
  },
  predictive: {
    label: "Prediktivt Underhåll",
    description: "AI-driven serviceprognos baserad på IoT-signaler",
    icon: "Activity",
    routes: ["/predictive-maintenance"],
    navItems: ["/predictive-maintenance"],
  },
  work_sessions: {
    label: "Arbetspass & Tid",
    description: "Check-in/check-out, tidrapportering, löneunderlag",
    icon: "Clock",
    routes: ["/work-sessions"],
    navItems: ["/work-sessions"],
  },
  order_concepts: {
    label: "Orderkoncept",
    description: "Avrop, schema, abonnemang — scenariobaserad automation",
    icon: "ListChecks",
    routes: ["/order-concepts"],
    navItems: ["/order-concepts"],
  },
  inspections: {
    label: "Besiktningar",
    description: "Inspektionsprotokoll och checklista-mallar",
    icon: "ClipboardCheck",
    routes: ["/inspections", "/checklist-templates"],
    navItems: ["/inspections", "/checklist-templates"],
  },
  sms: {
    label: "SMS-notifikationer",
    description: "SMS-utskick till kunder och fältpersonal",
    icon: "MessageSquare",
    routes: ["/sms-settings"],
    navItems: ["/sms-settings"],
  },
  route_feedback: {
    label: "Ruttfeedback",
    description: "Förarbetyg och feedbackrapporter per dag",
    icon: "Star",
    routes: ["/route-feedback"],
    navItems: ["/route-feedback"],
  },
  equipment_sharing: {
    label: "Utrustningsdelning",
    description: "Fordons- och utrustningsbokningar med kollisionskontroll",
    icon: "Share2",
    routes: ["/equipment-sharing"],
    navItems: ["/equipment-sharing"],
  },
  roi_reports: {
    label: "ROI-rapporter",
    description: "Avkastningsanalys per kund med delningslänkar",
    icon: "TrendingUp",
    routes: ["/roi-report"],
    navItems: ["/roi-report"],
  },
};

export type PackageTier = "basic" | "standard" | "premium" | "custom";

export interface PackageDefinition {
  tier: PackageTier;
  label: string;
  description: string;
  modules: ModuleKey[];
  price?: string;
}

export const PACKAGE_DEFINITIONS: Record<PackageTier, PackageDefinition> = {
  basic: {
    tier: "basic",
    label: "Bas",
    description: "Grundläggande fältservicehantering",
    modules: ["core", "work_sessions"],
    price: "Kontakta oss",
  },
  standard: {
    tier: "standard",
    label: "Standard",
    description: "Komplett fältservice med AI och kundportal",
    modules: ["core", "work_sessions", "ai_planning", "customer_portal", "invoicing", "inspections", "fleet", "order_concepts", "environmental"],
    price: "Kontakta oss",
  },
  premium: {
    tier: "premium",
    label: "Premium",
    description: "Fullständig plattform med alla moduler",
    modules: [...MODULE_KEYS] as ModuleKey[],
    price: "Kontakta oss",
  },
  custom: {
    tier: "custom",
    label: "Anpassad",
    description: "Skräddarsydd uppsättning av moduler",
    modules: [],
    price: "Kontakta oss",
  },
};

export function getModulesForPackage(tier: PackageTier): ModuleKey[] {
  return PACKAGE_DEFINITIONS[tier]?.modules ?? PACKAGE_DEFINITIONS.basic.modules;
}

export function isRouteInModule(route: string, moduleKey: ModuleKey): boolean {
  const basePath = "/" + route.split("/").filter(Boolean)[0];
  return MODULE_DEFINITIONS[moduleKey]?.routes.includes(basePath) ?? false;
}

export function getModuleForRoute(route: string): ModuleKey | null {
  const basePath = "/" + route.split("/").filter(Boolean)[0];
  if (!basePath || basePath === "/") return "core";
  for (const [key, def] of Object.entries(MODULE_DEFINITIONS)) {
    if (def.routes.includes(basePath)) return key as ModuleKey;
  }
  return "core";
}

export function isNavItemInModule(url: string, enabledModules: ModuleKey[]): boolean {
  const module = getModuleForRoute(url);
  if (!module) return true;
  return enabledModules.includes(module);
}
