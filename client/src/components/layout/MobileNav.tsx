import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import unicornLogo from "@assets/download_(3)_1766432059347.png";
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
  Sparkles,
  Package,
  Receipt,
  ClipboardList,
  Truck,
  RefreshCw,
  Settings2,
  Target,
  DollarSign,
  Timer,
  TrendingUp,
  Smartphone,
  Layers,
  Cloud,
  Building,
  Briefcase,
  Home,
  Palette,
} from "lucide-react";

const navigationGroups = [
  {
    title: "Start",
    items: [
      { title: "Startsidan", url: "/", icon: Home },
    ],
  },
  {
    title: "Grunddata",
    items: [
      { title: "Objekt", url: "/objects", icon: Building2 },
      { title: "Resurser", url: "/resources", icon: Users },
      { title: "Fordon", url: "/vehicles", icon: Truck },
      { title: "Artiklar", url: "/articles", icon: Package },
      { title: "Kluster", url: "/clusters", icon: Target },
    ],
  },
  {
    title: "Planering",
    items: [
      { title: "Veckoplanering", url: "/planner", icon: Calendar },
      { title: "Orderstock", url: "/order-stock", icon: ClipboardList },
      { title: "Mobilapp", url: "/mobile", icon: Smartphone },
      { title: "Rutter", url: "/routes", icon: Map },
    ],
  },
  {
    title: "Analys",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Ekonomi", url: "/economics", icon: DollarSign },
    ],
  },
  {
    title: "System",
    items: [
      { title: "Prislistor", url: "/price-lists", icon: Receipt },
      { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw },
      { title: "Fortnox", url: "/fortnox", icon: Receipt },
      { title: "Produktionsstyrning", url: "/planning-parameters", icon: Settings2 },
      { title: "Importera data", url: "/import", icon: Upload },
      { title: "Inställningar", url: "/settings", icon: Settings },
    ],
  },
  {
    title: "Avancerat",
    items: [
      { title: "Väderplanering", url: "/weather", icon: Cloud },
      { title: "AI-optimering", url: "/optimization", icon: Sparkles },
      { title: "Auto-klustring", url: "/auto-cluster", icon: Layers },
      { title: "Prediktiv planering", url: "/predictive-planning", icon: TrendingUp },
      { title: "Ställtidsanalys", url: "/setup-analysis", icon: Timer },
      { title: "Metadata", url: "/metadata", icon: FileText },
      { title: "Upphandlingar", url: "/procurements", icon: Briefcase },
      { title: "Kundportal", url: "/customer-portal", icon: Building },
      { title: "Systemöversikt", url: "/system-overview", icon: FileText },
      { title: "Admin", url: "/system-dashboard", icon: Palette },
    ],
  },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();

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
              src={unicornLogo}
              alt="Unicorn"
              className="h-8 w-auto"
              data-testid="img-mobile-nav-logo"
            />
            <SheetTitle className="text-lg">Unicorn</SheetTitle>
          </div>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-80px)]">
          <nav className="p-4 space-y-6" data-testid="mobile-nav-menu">
            {navigationGroups.map((group) => (
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
