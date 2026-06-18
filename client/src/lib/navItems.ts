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
  Palette,
  Inbox,
  Link2,
  Archive,
  Layers,
  Tag,
  Workflow,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { translate } from "./i18n";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  description: string;
  external?: boolean;
  /** Visa endast för platform-owner-tenant ("kinab"). Backend gatear redan
   * routen — detta är bara UX så vi inte visar menyposter som ger 403. */
  platformOwnerOnly?: boolean;
  /** Visa endast för admin/owner-roller. Används när en post ligger i en
   * meny-grupp som är öppen för bredare roller (t.ex. Grunddata), men där
   * själva åtgärden ändå är admin-only. */
  adminOnly?: boolean;
  /** Visuell undersektion i dropdown-menyn. Poster med samma värde grupperas
   * under en etikett med avdelare. Poster utan värde visas utan etikett. */
  subSection?: string;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: LucideIcon;
  colorClass: string;
  group: "grunddata" | "ordrar" | "planering" | "falt" | "analys" | "admin";
  items: NavItem[];
  /** Om satt renderas gruppen som en direktlänk i navbaren istället för dropdown. */
  directUrl?: string;
}

const svFallback = (k: string) => translate(k, "sv");

export function getGrunddataItems(t: (key: string, fallback: string) => string, tl?: (key: string) => string, lang?: string): NavItem[] {
  const l = tl || svFallback;
  const useI18n = lang === "en";
  return [
    // Kunder & objekt — vem och var arbetet utförs
    { title: "Kunder", url: "/customers", icon: Building, description: "Översikt av kunder, kluster och objekt", subSection: "Kunder & objekt" },
    { title: useI18n ? l("nav.objects") : t("object_plural", l("nav.objects")), url: "/objects", icon: Building2, description: l("nav.objects.desc"), subSection: "Kunder & objekt" },
    { title: "Objekt utan koordinater", url: "/objects/missing-coordinates", icon: Building2, description: "Lista över objekt som saknar lat/lng och kan geokodas på nytt", subSection: "Kunder & objekt" },
    // Resurser & utförare — vem som utför arbetet
    { title: useI18n ? l("nav.resources") : t("resource_plural", l("nav.resources")), url: "/resources", icon: Users, description: l("nav.resources.desc"), subSection: "Resurser & utförare" },
    { title: "Utförarregister", url: "/utforarregister", icon: UserCheck, description: "Samlad vy: personer, fordon/utrustning och team som en enhet — med kostnadsställe och projekt", subSection: "Resurser & utförare" },
    { title: useI18n ? l("nav.vehicles") : t("vehicle_plural", l("nav.vehicles")), url: "/vehicles", icon: Truck, description: l("nav.vehicles.desc"), subSection: "Resurser & utförare" },
    { title: l("nav.fleet"), url: "/fleet", icon: Fuel, description: l("nav.fleet.desc"), subSection: "Resurser & utförare" },
    // Artiklar & tjänster — vad som utförs
    { title: useI18n ? l("nav.articles") : t("article_plural", l("nav.articles")), url: "/articles", icon: Package, description: l("nav.articles.desc"), subSection: "Artiklar & tjänster" },
    { title: l("nav.article-components"), url: "/article-components", icon: Package, description: l("nav.article-components.desc"), subSection: "Artiklar & tjänster" },
    { title: "Strukturartiklar", url: "/structure-articles", icon: Layers, description: "Strukturartikelregister: paket av komponenter med kvantitet och rapportering", subSection: "Artiklar & tjänster" },
    { title: "Produktionstider", url: "/production-time-lists", icon: Clock, description: "Produktionstidslista per artikel, utförare och utrustning", subSection: "Artiklar & tjänster" },
    { title: "Artikeltyper", url: "/article-types", icon: Tag, description: "Hantera artikeltyper (kategorier) per organisation", adminOnly: true, subSection: "Artiklar & tjänster" },
    { title: "Utförandekoder", url: "/execution-codes", icon: Workflow, description: "Hantera utförandekoder (tjänstetyper) per organisation", adminOnly: true, subSection: "Artiklar & tjänster" },
    { title: "Ikoner", url: "/icons", icon: Shapes, description: "Hantera ikonbibliotek för artiklar per organisation", adminOnly: true, subSection: "Artiklar & tjänster" },
    // Inköp & pris
    { title: "Leverantörer", url: "/suppliers", icon: Truck, description: "Leverantörsregister med kontaktuppgifter och artikelkopplingar", adminOnly: true, subSection: "Inköp & pris" },
    { title: l("nav.price-lists"), url: "/price-lists", icon: Receipt, description: l("nav.price-lists.desc"), subSection: "Inköp & pris" },
    // Import
    { title: "Import", url: "/import", icon: Upload, description: "Importera data, objektmallar och spara importmallar", adminOnly: true, subSection: "Import" },
  ];
}

export function getOrdrarItems(t: (key: string, fallback: string) => string, tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    // Order & tilldelning — det dagliga orderflödet
    { title: l("nav.order-stock"), url: "/order-stock", icon: ClipboardList, description: l("nav.order-stock.desc"), subSection: "Order & tilldelning" },
    { title: l("nav.assignments"), url: "/assignments", icon: UserCheck, description: l("nav.assignments.desc"), subSection: "Order & tilldelning" },
    // Återkommande & koncept — det som genererar order
    { title: l("nav.subscriptions"), url: "/subscriptions", icon: RefreshCw, description: l("nav.subscriptions.desc"), subSection: "Återkommande & koncept" },
    { title: l("nav.order-concepts"), url: "/order-concepts", icon: ListChecks, description: l("nav.order-concepts.desc"), subSection: "Återkommande & koncept" },
    // Ärenden — avvikelser och felanmälningar
    { title: "Ärenden", url: "/cases", icon: Inbox, description: "Samlad vy: avvikelser, kund- och allmänhetens felanmälningar", subSection: "Ärenden" },
  ];
}

export function getPlaneringItems(tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    // Planeringstavlor — det dagliga planeringsarbetet
    { title: l("nav.week-planner"), url: "/planner", icon: Calendar, description: l("nav.week-planner.desc"), subSection: "Planeringstavlor" },
    { title: "Veckoplanering", url: "/veckoplanering", icon: CalendarDays, description: "168h-veckoschema per team: ej planerade jobb, kalender, ruttoptimerad tur och summering", subSection: "Planeringstavlor" },
    { title: "Grovplanering", url: "/grovplanering", icon: CalendarDays, description: "Ej planerade uppgifter: filtrera per distrikt, se på kartan och tilldela till team", subSection: "Planeringstavlor" },
    // Kartor & rutter
    { title: l("nav.route-planning"), url: "/routes", icon: Map, description: l("nav.route-planning.desc"), subSection: "Kartor & rutter" },
    { title: l("nav.planner-map"), url: "/planner-map", icon: MapPin, description: l("nav.planner-map.desc"), subSection: "Kartor & rutter" },
    { title: l("nav.historical-map"), url: "/historical-map", icon: History, description: l("nav.historical-map.desc"), subSection: "Kartor & rutter" },
    // Översikt & uppföljning
    { title: "Kontrollpanel", url: "/control-tower", icon: Gauge, description: "Värmekarta över beläggning och SLA-risk", subSection: "Översikt & uppföljning" },
    { title: "Produktionsledare", url: "/enhetsansvarig", icon: Target, description: "Dagsproduktion, lönsamhetsgräns per resurs och avvikelseprocess", subSection: "Översikt & uppföljning" },
    // Långsiktig planering
    { title: l("nav.annual-planning"), url: "/annual-planning", icon: Target, description: l("nav.annual-planning.desc"), subSection: "Långsiktig planering" },
    // Inställningar — uppsättning för planeringen
    { title: "Distrikt", url: "/distrikt", icon: Globe, description: "Hantera geografiska distrikt och zoner (postnummer/polygon)", subSection: "Inställningar" },
    { title: l("nav.production-control"), url: "/planning-parameters", icon: Settings2, description: l("nav.production-control.desc"), subSection: "Inställningar" },
    { title: l("nav.planner-search-filters"), url: "/planner-search-filters", icon: Sliders, description: l("nav.planner-search-filters.desc"), subSection: "Inställningar" },
    { title: "Utförandetyper", url: "/utforandetyper", icon: ListChecks, description: "Hantera utförandetyper och automatiska förberedelseuppgifter per typ", subSection: "Inställningar" },
  ];
}

export function getFaltItems(t: (key: string, fallback: string) => string, tl?: (key: string) => string, lang?: string): NavItem[] {
  const l = tl || svFallback;
  const useI18n = lang === "en";
  return [
    // Fältarbete — utförande i fält
    { title: l("nav.mobile-field"), url: "/mobile", icon: Smartphone, description: l("nav.mobile-field.desc"), subSection: "Fältarbete" },
    { title: l("nav.work-sessions"), url: "/work-sessions", icon: Clock, description: l("nav.work-sessions.desc"), subSection: "Fältarbete" },
    { title: useI18n ? l("nav.inspections") : t("inspection_singular", l("nav.inspections")), url: "/inspections", icon: ClipboardCheck, description: l("nav.inspections.desc"), subSection: "Fältarbete" },
    { title: l("nav.checklist-templates"), url: "/checklist-templates", icon: ClipboardCheck, description: l("nav.checklist-templates.desc"), subSection: "Fältarbete" },
    // Kund & portal — kundvänd kommunikation
    { title: l("nav.customer-portal"), url: "/customer-portal", icon: Building, description: l("nav.customer-portal.desc"), subSection: "Kund & portal" },
    { title: l("nav.portal-messages"), url: "/portal-messages", icon: MessageCircle, description: l("nav.portal-messages.desc"), subSection: "Kund & portal" },
    { title: l("nav.booking-slots"), url: "/booking-slots", icon: CalendarDays, description: l("nav.booking-slots.desc"), subSection: "Kund & portal" },
    { title: l("nav.customer-reports"), url: "/customer-reports", icon: Camera, description: l("nav.customer-reports.desc"), subSection: "Kund & portal" },
    // Kommunikation
    { title: l("nav.telephony"), url: "/telephony", icon: Phone, description: l("nav.telephony.desc"), subSection: "Kommunikation" },
  ];
}

export function getEkonomiItems(tl?: (key: string) => string): NavItem[] {
  const l = tl || svFallback;
  return [
    // Fakturering — fakturaflödet
    { title: l("nav.invoicing"), url: "/invoicing", icon: Receipt, description: l("nav.invoicing.desc"), subSection: "Fakturering" },
    { title: "Fakturakö", url: "/invoice-queue", icon: Clock, description: "Bromsade arbetsorder + samlingsfakturor (konsoliderings-policy per mottagare)", subSection: "Fakturering" },
    { title: l("nav.invoice-recalculation-log"), url: "/invoice-recalculation-log", icon: Receipt, description: l("nav.invoice-recalculation-log.desc"), subSection: "Fakturering" },
    // Rapporter & analys
    { title: l("nav.economics"), url: "/economics", icon: DollarSign, description: l("nav.economics.desc"), subSection: "Rapporter & analys" },
    { title: l("nav.reporting"), url: "/reporting", icon: BarChart3, description: l("nav.reporting.desc"), subSection: "Rapporter & analys" },
    { title: "Veckomötes-rapport", url: "/weekly-report", icon: FileText, description: "Sammanställd rapport för planeringsmötet (utfall, trender, plan, kvalitet) – PDF via utskrift", subSection: "Rapporter & analys" },
    { title: l("nav.roi-report"), url: "/roi-report", icon: TrendingUp, description: l("nav.roi-report.desc"), subSection: "Rapporter & analys" },
    // Försäljning
    { title: l("nav.proactive-sales"), url: "/proactive-sales", icon: TrendingUp, description: l("nav.proactive-sales.desc"), subSection: "Försäljning" },
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
    // Organisation & användare
    { title: l("nav.company-settings"), url: "/tenant-config", icon: Settings2, description: l("nav.company-settings.desc"), subSection: "Organisation & användare" },
    { title: l("nav.user-management"), url: "/user-management", icon: Users, description: l("nav.user-management.desc"), subSection: "Organisation & användare" },
    { title: l("nav.settings"), url: "/settings", icon: Settings, description: l("nav.settings.desc"), subSection: "Organisation & användare" },
    // Metadata
    { title: "Metadata", url: "/metadata-settings", icon: Database, description: "Metadatakatalog, definitioner och koppling per ordertyp", subSection: "Metadata" },
    { title: "Metadata-lämnare", url: "/metadata-editors", icon: ClipboardCheck, description: "Bygg publika formulär för insamling av metadata (granskas innan de registreras)", subSection: "Metadata" },
    { title: "Metadata-granskning", url: "/metadata-granskning", icon: Inbox, description: "Granska och godkänn inlämningar från publika metadata-lämnare", subSection: "Metadata" },
    // Integrationer
    { title: l("nav.fortnox"), url: "/fortnox", icon: Receipt, description: l("nav.fortnox.desc"), subSection: "Integrationer" },
    { title: l("nav.sms-settings"), url: "/sms-settings", icon: MessageSquare, description: l("nav.sms-settings.desc"), subSection: "Integrationer" },
    // Drift & data
    { title: l("nav.api-costs"), url: "/api-costs", icon: Activity, description: l("nav.api-costs.desc"), subSection: "Drift & data" },
    { title: "Datakvalitet för prognoser", url: "/ml-data-quality", icon: Activity, description: "Datakvalitet för automatisk tidsberäkning", subSection: "Drift & data" },
    { title: "Arkiv", url: "/archive", icon: Archive, description: "Arkiverade objekt, ordrar, bilder, kontakter och metadatatyper — sök, filtrera och återställ", subSection: "Drift & data" },
    { title: "Återställ vilande kunder", url: "/restore-dormant-customers", icon: Database, description: "Sök fram en vilande kund och återställ den från dev till prod (platform-owner)", subSection: "Drift & data" },
    // Plattform (owner)
    { title: "Plattform: Användare & GDPR", url: "/platform-admin", icon: UserCheck, description: "Cross-tenant användarvy, GDPR-anonymisering och hård radering (platform-owner)", platformOwnerOnly: true, subSection: "Plattform" },
    { title: "Plattform: Branding & roller", url: "/system-dashboard", icon: Palette, description: l("nav.platform-admin.desc"), subSection: "Plattform" },
    { title: "Kart-leverantör", url: "/shadow-comparison", icon: Activity, description: "Jämförelse av kartleverantörer: avvikelser, volym och kostnad", platformOwnerOnly: true, subSection: "Plattform" },
    { title: l("nav.system-overview"), url: "/system-overview", icon: FileText, description: l("nav.system-overview.desc"), subSection: "Plattform" },
    // Externt
    { title: "Kundportal extern", url: "/portal", icon: Globe, description: "Öppna den externa kundportalen i ny flik", external: true, subSection: "Externt" },
  ];
}

export const adminItems: NavItem[] = getAdminItems();

export function getNavGroups(t: (key: string, fallback: string) => string, tl?: (key: string) => string, lang?: string): NavGroup[] {
  const l = tl || svFallback;
  return [
    { key: "ordrar", label: l("nav.ordrar"), items: getOrdrarItems(t, tl), icon: ClipboardList, group: "ordrar", colorClass: "text-chart-4" },
    { key: "planering", label: l("nav.planering"), items: getPlaneringItems(tl), icon: Calendar, group: "planering", colorClass: "text-chart-2", directUrl: "/planering" },
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
