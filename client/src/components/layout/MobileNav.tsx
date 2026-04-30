import { useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { canAccessRoute } from "@/lib/role-config";
import { useLanguage } from "@/hooks/use-language";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import traivoLogo from "@assets/traivo_logo_transparent.png";
import {
  Menu,
  Calendar,
  Map,
  Building2,
  LayoutDashboard,
  Users,
  Settings,
  Upload,
  FileText,
  Brain,
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
  Building,
  ListChecks,
  UserCheck,
  Database,
  MapPin,
  History,
  BarChart3,
  Fuel,
  MessageSquare,
  Activity,
  Gauge,
  Globe,
  ExternalLink,
} from "lucide-react";

interface MobileNavItem {
  title: string;
  url: string;
  icon: typeof Calendar;
  external?: boolean;
}

interface MobileNavGroup {
  title: string;
  items: MobileNavItem[];
}

function getNavigationGroups(tl: (key: string) => string): MobileNavGroup[] {
  return [
    {
      title: tl("mobile.start"),
      items: [
        { title: tl("nav.today"), url: "/", icon: Calendar },
        { title: tl("nav.dashboard"), url: "/dashboard", icon: LayoutDashboard },
      ],
    },
    {
      title: tl("mobile.grunddata"),
      items: [
        { title: tl("nav.clusters"), url: "/clusters", icon: Target },
        { title: tl("nav.auto-cluster"), url: "/auto-cluster", icon: Layers },
        { title: tl("nav.objects"), url: "/objects", icon: Building2 },
        { title: tl("nav.resources"), url: "/resources", icon: Users },
        { title: tl("nav.vehicles"), url: "/vehicles", icon: Truck },
        { title: tl("nav.articles"), url: "/articles", icon: Package },
        { title: tl("nav.price-lists"), url: "/price-lists", icon: Receipt },
      ],
    },
    {
      title: tl("mobile.ordrar"),
      items: [
        { title: tl("nav.subscriptions"), url: "/subscriptions", icon: RefreshCw },
        { title: tl("nav.order-concepts"), url: "/order-concepts", icon: ListChecks },
        { title: tl("nav.order-stock"), url: "/order-stock", icon: ClipboardList },
        { title: tl("nav.assignments"), url: "/assignments", icon: UserCheck },
      ],
    },
    {
      title: tl("mobile.planering"),
      items: [
        { title: tl("nav.week-planner"), url: "/planner", icon: Calendar },
        { title: tl("nav.route-planning"), url: "/routes", icon: Map },
        { title: tl("nav.planner-map"), url: "/planner-map", icon: MapPin },
        { title: tl("nav.historical-map"), url: "/historical-map", icon: History },
        { title: "Kontrollpanel", url: "/control-tower", icon: Gauge },
      ],
    },
    {
      title: tl("mobile.falt"),
      items: [
        { title: tl("nav.mobile-field"), url: "/mobile", icon: Smartphone },
        { title: tl("nav.inspections"), url: "/inspections", icon: ClipboardList },
        { title: tl("nav.checklist-templates"), url: "/checklist-templates", icon: ClipboardList },
        { title: tl("nav.customer-portal"), url: "/customer-portal", icon: Building },
      ],
    },
    {
      title: tl("mobile.analys"),
      items: [
        { title: tl("nav.ai-assistant"), url: "/ai-assistant", icon: Brain },
        { title: tl("nav.reporting"), url: "/reporting", icon: BarChart3 },
        { title: tl("nav.economics"), url: "/economics", icon: DollarSign },
        { title: tl("nav.invoicing"), url: "/invoicing", icon: Receipt },
        { title: tl("nav.fleet"), url: "/fleet", icon: Fuel },
        { title: tl("nav.predictive-planning"), url: "/predictive-planning", icon: TrendingUp },
      ],
    },
    {
      title: tl("mobile.admin"),
      items: [
        { title: tl("nav.production-control"), url: "/planning-parameters", icon: Settings2 },
        { title: tl("nav.user-management"), url: "/user-management", icon: Users },
        { title: tl("nav.import"), url: "/import", icon: Upload },
        { title: tl("nav.metadata-settings"), url: "/metadata-settings", icon: Database },
        { title: tl("nav.api-costs"), url: "/api-costs", icon: Activity },
        { title: tl("nav.system-overview"), url: "/system-overview", icon: FileText },
        { title: tl("nav.settings"), url: "/settings", icon: Settings },
        { title: "Kundportal extern", url: "/portal", icon: Globe, external: true },
      ],
    },
  ];
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { user } = useAuth();
  const userRole = user?.role;
  const { t: tl } = useLanguage();

  const filteredGroups = useMemo(() => {
    return getNavigationGroups(tl)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canAccessRoute(userRole, item.url)),
      }))
      .filter((group) => group.items.length > 0);
  }, [userRole, tl]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          data-testid="button-mobile-menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 p-0" data-testid="mobile-nav-sheet">
        <SheetHeader className="p-4 border-b">
          <div className="flex items-center gap-3">
            <img src={traivoLogo} alt="Traivo" className="h-14 w-auto object-contain mix-blend-multiply dark:mix-blend-screen dark:brightness-150 dark:contrast-200" data-testid="img-mobile-nav-logo" />
            <SheetTitle className="sr-only">Traivo</SheetTitle>
          </div>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-80px)]">
          <nav className="p-4 space-y-6" data-testid="mobile-nav-menu">
            {filteredGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const external = item.external;
                    const className = `flex items-center gap-3 px-3 py-2 rounded-md hover-elevate active-elevate-2 ${
                      !external && location === item.url
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground"
                    }`;
                    if (external) {
                      return (
                        <a
                          key={item.url}
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setOpen(false)}
                          data-testid={`mobile-nav-${item.url.replace("/", "") || "home"}`}
                          className={className}
                        >
                          <item.icon className="h-4 w-4" />
                          <span className="text-sm font-medium flex-1">{item.title}</span>
                          <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                        </a>
                      );
                    }
                    return (
                      <Link
                        key={item.url}
                        href={item.url}
                        onClick={() => setOpen(false)}
                        data-testid={`mobile-nav-${item.url.replace("/", "") || "home"}`}
                        className={className}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="text-sm font-medium">{item.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
