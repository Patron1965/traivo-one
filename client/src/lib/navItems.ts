import {
  Calendar,
  Map,
  Building2,
  Users,
  Settings,
  Upload,
  FileText,
  Package,
  Receipt,
  ClipboardList,
  Truck,
  RefreshCw,
  Settings2,
  Target,
  DollarSign,
  TrendingUp,
  Smartphone,
  Layers,
  Cloud,
  Building,
  Database,
  BarChart3,
  History,
  ListChecks,
  UserCheck,
  Brain,
  MapPin,
  Fuel,
  ClipboardCheck,
  Activity,
  Clock,
  MessageSquare,
  Camera,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  description: string;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  colorClass: string;
  group: "grunddata" | "ordrar" | "planering" | "falt" | "analys" | "admin";
  items: NavItem[];
}

export function getGrunddataItems(t: (key: string, fallback: string) => string): NavItem[] {
  return [
    { title: t("cluster_plural", "Kluster"), url: "/clusters", icon: Target, description: "Arbetsområden" },
    { title: "Auto-klustring", url: "/auto-cluster", icon: Layers, description: "Automatisk områdesindelning" },
    { title: t("object_plural", "Objekt"), url: "/objects", icon: Building2, description: "Fastigheter och platser" },
    { title: t("resource_plural", "Resurser"), url: "/resources", icon: Users, description: "Personal" },
    { title: "Arbetspass", url: "/work-sessions", icon: Clock, description: "Tidloggning och löneunderlag" },
    { title: t("vehicle_plural", "Fordon"), url: "/vehicles", icon: Truck, description: t("vehicle_plural", "Fordon") },
    { title: t("article_plural", "Artiklar"), url: "/articles", icon: Package, description: "Produkter och tjänster" },
    { title: "Prislistor", url: "/price-lists", icon: Receipt, description: "Prissättning" },
  ];
}

export function getOrdrarItems(t: (key: string, fallback: string) => string): NavItem[] {
  return [
    { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw, description: "Återkommande tjänster" },
    { title: "Orderkoncept", url: "/order-concepts", icon: ListChecks, description: "Intelligenta ordergeneratorer" },
    { title: "Orderstock", url: "/order-stock", icon: ClipboardList, description: `Alla ${t("work_order_plural", "uppgifter").toLowerCase()}` },
    { title: "Uppdrag", url: "/assignments", icon: UserCheck, description: "Genererade uppgifter" },
  ];
}

export function getPlaneringItems(): NavItem[] {
  return [
    { title: "Veckoplanering", url: "/planner", icon: Calendar, description: "Planera veckans arbete" },
    { title: "Ruttplanering", url: "/routes", icon: Map, description: "Optimera körvägar" },
    { title: "Planerarvy Karta", url: "/planner-map", icon: MapPin, description: "Realtidskarta med förare och uppdrag" },
    { title: "Historisk Kartvy", url: "/historical-map", icon: History, description: "Spela upp rörelsemönster" },
    { title: "Väderplanering", url: "/weather", icon: Cloud, description: "Planera efter väder" },
    { title: "Årsplanering", url: "/annual-planning", icon: Target, description: "Årsmål & uppföljning" },
  ];
}

export function getFaltItems(t: (key: string, fallback: string) => string): NavItem[] {
  return [
    { title: "Mobilapp Fält", url: "/mobile", icon: Smartphone, description: "Fältarbete och protokoll" },
    { title: t("inspection_singular", "Besiktning"), url: "/inspections", icon: ClipboardCheck, description: "Inspektionsprotokoll" },
    { title: "Kontrollmallar", url: "/checklist-templates", icon: ClipboardCheck, description: "Inspektionsfrågor per artikeltyp" },
    { title: "Kundportal", url: "/customer-portal", icon: Building, description: "Extern kundvy" },
    { title: "Kundrapporter", url: "/customer-reports", icon: Camera, description: "Fältrapporter från kunder" },
  ];
}

export function getAnalysItems(): NavItem[] {
  return [
    { title: "AI-Assistent", url: "/ai-assistant", icon: Brain, description: "AI-analys och optimering" },
    { title: "Rapportering", url: "/reporting", icon: BarChart3, description: "KPI och rapporter" },
    { title: "Ekonomi", url: "/economics", icon: DollarSign, description: "Intäkter och kostnader" },
    { title: "Fakturering", url: "/invoicing", icon: Receipt, description: "Fakturahantering och Fortnox-export" },
    { title: "Fleethantering", url: "/fleet", icon: Fuel, description: "Fordonsöversikt, underhåll och bränsle" },
    { title: "Prediktiv Planering", url: "/predictive-planning", icon: TrendingUp, description: "AI-prognoser" },
    { title: "Prediktivt Underhåll", url: "/predictive-maintenance", icon: Activity, description: "IoT-baserad serviceprognos" },
    { title: "ROI-rapport", url: "/roi-report", icon: TrendingUp, description: "Avkastningsanalys per kund" },
  ];
}

export const adminItems: NavItem[] = [
  { title: "Produktionsstyrning", url: "/planning-parameters", icon: Settings2, description: "SLA och tider" },
  { title: "Användarhantering", url: "/user-management", icon: Users, description: "Hantera användare och roller" },
  { title: "Företagsinställningar", url: "/tenant-config", icon: Settings2, description: "Företag, artiklar, koder" },
  { title: "Ny kund", url: "/onboarding", icon: Building2, description: "Skapa ny kund/företag" },
  { title: "SMS-inställningar", url: "/sms-settings", icon: MessageSquare, description: "SMS-notifikationer" },
  { title: "Fortnox", url: "/fortnox", icon: Receipt, description: "Fakturaexport" },
  { title: "Importera data", url: "/import", icon: Upload, description: "Importera från fil" },
  { title: "Metadatainställningar", url: "/metadata-settings", icon: Database, description: "Metadatakatalog" },
  { title: "API-kostnader", url: "/api-costs", icon: Activity, description: "Övervaka API-användning" },
  { title: "Systemöversikt", url: "/system-overview", icon: FileText, description: "Datastatistik" },
  { title: "Inställningar", url: "/settings", icon: Settings, description: "Systeminställningar" },
];

export function getNavGroups(t: (key: string, fallback: string) => string): NavGroup[] {
  return [
    { key: "grunddata", label: "Grunddata", items: getGrunddataItems(t), icon: Database, group: "grunddata", colorClass: "text-blue-500" },
    { key: "ordrar", label: "Ordrar", items: getOrdrarItems(t), icon: ClipboardList, group: "ordrar", colorClass: "text-amber-500" },
    { key: "planering", label: "Planering & Karta", items: getPlaneringItems(), icon: Calendar, group: "planering", colorClass: "text-green-500" },
    { key: "falt", label: "Fält & Utförande", items: getFaltItems(t), icon: Smartphone, group: "falt", colorClass: "text-teal-500" },
    { key: "analys", label: "Analys", items: getAnalysItems(), icon: BarChart3, group: "analys", colorClass: "text-purple-500" },
    { key: "admin", label: "Administration", items: adminItems, icon: Settings, group: "admin", colorClass: "text-orange-500" },
  ];
}

export const sidebarStartItems: NavItem[] = [
  { title: "Dagens arbete", url: "/", icon: Calendar, description: "" },
  { title: "Dashboard", url: "/dashboard", icon: BarChart3, description: "" },
];
