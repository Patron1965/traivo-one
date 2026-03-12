import { useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { canAccessRoute } from "@/lib/role-config";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import nordfieldLogo from "@assets/nordnav_one_logo_final_upward_1773311964126.png";
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
  Cloud,
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
} from "lucide-react";

const navigationGroups = [
  {
    title: "Start",
    items: [
      { title: "Dagens arbete", url: "/", icon: Calendar },
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Grunddata",
    items: [
      { title: "Kluster", url: "/clusters", icon: Target },
      { title: "Auto-klustring", url: "/auto-cluster", icon: Layers },
      { title: "Objekt", url: "/objects", icon: Building2 },
      { title: "Resurser", url: "/resources", icon: Users },
      { title: "Fordon", url: "/vehicles", icon: Truck },
      { title: "Artiklar", url: "/articles", icon: Package },
      { title: "Prislistor", url: "/price-lists", icon: Receipt },
    ],
  },
  {
    title: "Ordrar",
    items: [
      { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw },
      { title: "Orderkoncept", url: "/order-concepts", icon: ListChecks },
      { title: "Orderstock", url: "/order-stock", icon: ClipboardList },
      { title: "Uppdrag", url: "/assignments", icon: UserCheck },
    ],
  },
  {
    title: "Planering & Karta",
    items: [
      { title: "Veckoplanering", url: "/planner", icon: Calendar },
      { title: "Ruttplanering", url: "/routes", icon: Map },
      { title: "Planerarvy Karta", url: "/planner-map", icon: MapPin },
      { title: "Historisk Kartvy", url: "/historical-map", icon: History },
      { title: "Väderplanering", url: "/weather", icon: Cloud },
    ],
  },
  {
    title: "Fält & Utförande",
    items: [
      { title: "Mobilapp Fält", url: "/mobile", icon: Smartphone },
      { title: "Besiktning", url: "/inspections", icon: ClipboardList },
      { title: "Checklista-mallar", url: "/checklist-templates", icon: ClipboardList },
      { title: "Kundportal", url: "/customer-portal", icon: Building },
    ],
  },
  {
    title: "Analys",
    items: [
      { title: "AI-Assistent", url: "/ai-assistant", icon: Brain },
      { title: "Rapportering", url: "/reporting", icon: BarChart3 },
      { title: "Ekonomi", url: "/economics", icon: DollarSign },
      { title: "Fakturering", url: "/invoicing", icon: Receipt },
      { title: "Fleethantering", url: "/fleet", icon: Fuel },
      { title: "Prediktiv Planering", url: "/predictive-planning", icon: TrendingUp },
    ],
  },
  {
    title: "Administration",
    items: [
      { title: "Produktionsstyrning", url: "/planning-parameters", icon: Settings2 },
      { title: "Användarhantering", url: "/user-management", icon: Users },
      { title: "Importera data", url: "/import", icon: Upload },
      { title: "Metadatainställningar", url: "/metadata-settings", icon: Database },
      { title: "API-kostnader", url: "/api-costs", icon: Activity },
      { title: "Systemöversikt", url: "/system-overview", icon: FileText },
      { title: "Inställningar", url: "/settings", icon: Settings },
    ],
  },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { user } = useAuth();
  const userRole = user?.role;

  const filteredGroups = useMemo(() => {
    return navigationGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canAccessRoute(userRole, item.url)),
      }))
      .filter((group) => group.items.length > 0);
  }, [userRole]);

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
            <img
              src={nordfieldLogo}
              alt="Nordnav One"
              className="h-10 w-auto mix-blend-multiply dark:mix-blend-normal dark:invert dark:hue-rotate-[180deg]"
              data-testid="img-mobile-nav-logo"
            />
            <SheetTitle className="sr-only">Nordnav One</SheetTitle>
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
                  {group.items.map((item) => (
                    <Link
                      key={item.url}
                      href={item.url}
                      onClick={() => setOpen(false)}
                      data-testid={`mobile-nav-${item.url.replace("/", "") || "home"}`}
                      className={`flex items-center gap-3 px-3 py-2 rounded-md hover-elevate active-elevate-2 ${
                        location === item.url
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      <span className="text-sm font-medium">{item.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
