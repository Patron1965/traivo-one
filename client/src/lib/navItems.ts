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
  Sliders,
  Target,
  DollarSign,
  TrendingUp,
  Smartphone,
  Layers,
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
  Phone,
  CalendarDays,
  MessageCircle,
  Gauge,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { translate } from "./i18n";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  description: string;
  external?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  colorClass: string;
  group: "grunddata" | "ordrar" | "planering" | "falt" | "analys" | "admin";
  items: NavItem[];
}

const svFallback = (k: string) => translate(k, "sv");

export function getGrunddataItems(t: (key: string, fallback: string) => string, tl?: (key: string) => string, lang?: string): NavItem[] {
  const l = tl || svFallback;
  const useI18n = lang === "en";
  return [
    { title: "Kunder", url: "/customers", icon: Building, description: "Översikt av kunder, kluster och objekt" },
    { title: useI18n ? l("nav.objects") : t("object_plural", l("nav.objects")), url: "/objects", icon: Building2, description: l("nav.objects.desc") },
    { title: useI18n ? l("nav.clusters") : t("cluster_plural", l("nav.clusters")), url: "/clusters", icon: Target, description: l("nav.clusters.desc") },
    { title: l("nav.auto-cluster"), url: "/auto-cluster", icon: Layers, description: l("nav.auto-cluster.desc") },
    { title: useI18n ? l("nav.resources") : t("resource_plural", l("nav.resources")), url: "/resources", icon: Users, description: l("nav.resources.desc") },
    { title: useI18n ? l("nav.vehicles") : t("vehicle_plural", l("nav.vehicles")), url: "/vehicles", icon: Truck, description: l("nav.vehicles.desc") },
    { title: l("nav.fleet"), url: "/fleet", icon: Fuel, description: l("nav.fleet.desc") },
    { title: useI18n ? l("nav.articles") : t("article_plural", l("nav.articles")), url: "/articles", icon: Package, description: l("nav.articles.desc") },
    { title: l("nav.price-lists"), url: "/price-lists", icon: Receipt, description: l("nav.price-lists.desc") },
  ];
}

export function getOrdrarItems(t: (key: string, fallback: string) => string, tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    { title: l("nav.order-concepts"), url: "/order-concepts", icon: ListChecks, description: l("nav.order-concepts.desc") },
    { title: l("nav.subscriptions"), url: "/subscriptions", icon: RefreshCw, description: l("nav.subscriptions.desc") },
    { title: l("nav.order-stock"), url: "/order-stock", icon: ClipboardList, description: l("nav.order-stock.desc") },
    { title: l("nav.assignments"), url: "/assignments", icon: UserCheck, description: l("nav.assignments.desc") },
  ];
}

export function getPlaneringItems(tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    { title: "Kontrollpanel", url: "/control-tower", icon: Gauge, description: "Heatmap med beläggning och SLA-risk" },
    { title: l("nav.annual-planning"), url: "/annual-planning", icon: Target, description: l("nav.annual-planning.desc") },
    { title: l("nav.week-planner"), url: "/planner", icon: Calendar, description: l("nav.week-planner.desc") },
    { title: l("nav.route-planning"), url: "/routes", icon: Map, description: l("nav.route-planning.desc") },
  ];
}

export function getOvervakningItems(tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    { title: l("nav.planner-map"), url: "/planner-map", icon: MapPin, description: l("nav.planner-map.desc") },
    { title: l("nav.historical-map"), url: "/historical-map", icon: History, description: l("nav.historical-map.desc") },
  ];
}

export function getFaltItems(t: (key: string, fallback: string) => string, tl?: (key: string) => string, lang?: string): NavItem[] {
  const l = tl || svFallback;
  const useI18n = lang === "en";
  return [
    { title: l("nav.mobile-field"), url: "/mobile", icon: Smartphone, description: l("nav.mobile-field.desc") },
    { title: l("nav.work-sessions"), url: "/work-sessions", icon: Clock, description: l("nav.work-sessions.desc") },
    { title: useI18n ? l("nav.inspections") : t("inspection_singular", l("nav.inspections")), url: "/inspections", icon: ClipboardCheck, description: l("nav.inspections.desc") },
    { title: l("nav.checklist-templates"), url: "/checklist-templates", icon: ClipboardCheck, description: l("nav.checklist-templates.desc") },
    { title: l("nav.customer-portal"), url: "/customer-portal", icon: Building, description: l("nav.customer-portal.desc") },
    { title: l("nav.booking-slots"), url: "/booking-slots", icon: CalendarDays, description: l("nav.booking-slots.desc") },
    { title: l("nav.portal-messages"), url: "/portal-messages", icon: MessageCircle, description: l("nav.portal-messages.desc") },
    { title: l("nav.customer-reports"), url: "/customer-reports", icon: Camera, description: l("nav.customer-reports.desc") },
    { title: l("nav.telephony"), url: "/telephony", icon: Phone, description: l("nav.telephony.desc") },
  ];
}

export function getEkonomiItems(tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    { title: l("nav.invoicing"), url: "/invoicing", icon: Receipt, description: l("nav.invoicing.desc") },
    { title: l("nav.economics"), url: "/economics", icon: DollarSign, description: l("nav.economics.desc") },
    { title: l("nav.reporting"), url: "/reporting", icon: BarChart3, description: l("nav.reporting.desc") },
    { title: l("nav.roi-report"), url: "/roi-report", icon: TrendingUp, description: l("nav.roi-report.desc") },
    { title: l("nav.proactive-sales"), url: "/proactive-sales", icon: TrendingUp, description: l("nav.proactive-sales.desc") },
  ];
}

export function getAIItems(tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    { title: l("nav.ai-assistant"), url: "/ai-assistant", icon: Brain, description: l("nav.ai-assistant.desc") },
    { title: l("nav.predictive-planning"), url: "/predictive-planning", icon: TrendingUp, description: l("nav.predictive-planning.desc") },
    { title: l("nav.predictive-maintenance"), url: "/predictive-maintenance", icon: Activity, description: l("nav.predictive-maintenance.desc") },
  ];
}

export function getAdminItems(tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    { title: l("nav.new-customer"), url: "/onboarding", icon: Building2, description: l("nav.new-customer.desc") },
    { title: l("nav.company-settings"), url: "/tenant-config", icon: Settings2, description: l("nav.company-settings.desc") },
    { title: l("nav.production-control"), url: "/planning-parameters", icon: Settings2, description: l("nav.production-control.desc") },
    { title: l("nav.planner-search-filters"), url: "/planner-search-filters", icon: Sliders, description: l("nav.planner-search-filters.desc") },
    { title: l("nav.article-components"), url: "/article-components", icon: Package, description: l("nav.article-components.desc") },
    { title: l("nav.invoice-recalculation-log"), url: "/invoice-recalculation-log", icon: Receipt, description: l("nav.invoice-recalculation-log.desc") },
    { title: l("nav.metadata-settings"), url: "/metadata-settings", icon: Database, description: l("nav.metadata-settings.desc") },
    { title: l("nav.user-management"), url: "/user-management", icon: Users, description: l("nav.user-management.desc") },
    { title: l("nav.settings"), url: "/settings", icon: Settings, description: l("nav.settings.desc") },
    { title: l("nav.fortnox"), url: "/fortnox", icon: Receipt, description: l("nav.fortnox.desc") },
    { title: l("nav.sms-settings"), url: "/sms-settings", icon: MessageSquare, description: l("nav.sms-settings.desc") },
    { title: l("nav.import"), url: "/import", icon: Upload, description: l("nav.import.desc") },
    { title: "Objekt utan koordinater", url: "/objects/missing-coordinates", icon: Building2, description: "Lista över objekt som saknar lat/lng och kan geokodas på nytt" },
    { title: l("nav.api-costs"), url: "/api-costs", icon: Activity, description: l("nav.api-costs.desc") },
    { title: l("nav.system-overview"), url: "/system-overview", icon: FileText, description: l("nav.system-overview.desc") },
    { title: "Kundportal extern", url: "/portal", icon: Globe, description: "Öppna den externa kundportalen i ny flik", external: true },
  ];
}

export const adminItems: NavItem[] = getAdminItems();

export function getNavGroups(t: (key: string, fallback: string) => string, tl?: (key: string) => string, lang?: string): NavGroup[] {
  const l = tl || svFallback;
  return [
    { key: "ordrar", label: l("nav.ordrar"), items: getOrdrarItems(t, tl), icon: ClipboardList, group: "ordrar", colorClass: "text-chart-4" },
    { key: "planering", label: l("nav.planering"), items: [...getPlaneringItems(tl), ...getOvervakningItems(tl)], icon: Calendar, group: "planering", colorClass: "text-chart-2" },
    { key: "falt", label: l("nav.falt"), items: getFaltItems(t, tl, lang), icon: Smartphone, group: "falt", colorClass: "text-chart-2" },
    { key: "ekonomi", label: l("nav.ekonomi"), items: getEkonomiItems(tl), icon: BarChart3, group: "analys", colorClass: "text-chart-5" },
    { key: "ai", label: l("nav.ai"), items: getAIItems(tl), icon: Brain, group: "analys", colorClass: "text-chart-5" },
    { key: "grunddata", label: l("nav.grunddata"), items: getGrunddataItems(t, tl, lang), icon: Database, group: "grunddata", colorClass: "text-chart-1" },
    { key: "admin", label: l("nav.admin"), items: getAdminItems(tl), icon: Settings, group: "admin", colorClass: "text-chart-4" },
  ];
}

export function getSidebarStartItems(tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    { title: l("nav.today"), url: "/", icon: Calendar, description: "" },
    { title: l("nav.dashboard"), url: "/dashboard", icon: BarChart3, description: "" },
  ];
}

export const sidebarStartItems: NavItem[] = getSidebarStartItems();
