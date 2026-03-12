import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTenantBranding } from "@/components/TenantBrandingProvider";
import nordfieldLogo from "@assets/nordnav_one_logo_final_upward_1773311964126.png";
import { canAccessMenu, getRoleLabel, type NavMenuGroup } from "@/lib/role-config";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalAIButton } from "@/components/GlobalAIButton";
import { MobileNav } from "@/components/layout/MobileNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TourMenu } from "@/components/TourMenu";
import {
  Calendar,
  Map,
  Building2,
  LayoutDashboard,
  Users,
  Settings,
  LogOut,
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
  Search,
  Bell,
  ChevronDown,
  Database,
  BarChart3,
  History,
  Home,
  MessageSquare,
  MapPin,
  Fuel,
  UserCheck,
  ListChecks,
  Activity,
} from "lucide-react";

const grunddataItems = [
  { title: "Kluster", url: "/clusters", icon: Target, description: "Arbetsområden" },
  { title: "Auto-klustring", url: "/auto-cluster", icon: Layers, description: "Automatisk områdesindelning" },
  { title: "Objekt", url: "/objects", icon: Building2, description: "Fastigheter och platser" },
  { title: "Resurser", url: "/resources", icon: Users, description: "Personal" },
  { title: "Fordon", url: "/vehicles", icon: Truck, description: "Fordon" },
  { title: "Artiklar", url: "/articles", icon: Package, description: "Produkter och tjänster" },
  { title: "Prislistor", url: "/price-lists", icon: Receipt, description: "Prissättning" },
];

const ordrarItems = [
  { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw, description: "Återkommande tjänster" },
  { title: "Orderkoncept", url: "/order-concepts", icon: ListChecks, description: "Intelligenta ordergeneratorer" },
  { title: "Orderstock", url: "/order-stock", icon: ClipboardList, description: "Alla ordrar" },
  { title: "Uppdrag", url: "/assignments", icon: UserCheck, description: "Genererade uppgifter" },
];

const planeringItems = [
  { title: "Veckoplanering", url: "/planner", icon: Calendar, description: "Planera veckans arbete" },
  { title: "Ruttplanering", url: "/routes", icon: Map, description: "Optimera körvägar" },
  { title: "Planerarvy Karta", url: "/planner-map", icon: MapPin, description: "Realtidskarta med förare och uppdrag" },
  { title: "Historisk Kartvy", url: "/historical-map", icon: History, description: "Spela upp rörelsemönster" },
  { title: "Väderplanering", url: "/weather", icon: Cloud, description: "Planera efter väder" },
];

const faltItems = [
  { title: "Mobilapp Fält", url: "/mobile", icon: Smartphone, description: "Fältarbete och protokoll" },
  { title: "Besiktning", url: "/inspections", icon: ClipboardList, description: "Inspektionsprotokoll" },
  { title: "Checklista-mallar", url: "/checklist-templates", icon: ClipboardList, description: "Inspektionsfrågor per artikeltyp" },
  { title: "Kundportal", url: "/customer-portal", icon: Building, description: "Extern kundvy" },
];

const analysItems = [
  { title: "AI-Assistent", url: "/ai-assistant", icon: Brain, description: "AI-analys och optimering" },
  { title: "Rapportering", url: "/reporting", icon: BarChart3, description: "KPI och rapporter" },
  { title: "Ekonomi", url: "/economics", icon: DollarSign, description: "Intäkter och kostnader" },
  { title: "Fakturering", url: "/invoicing", icon: Receipt, description: "Fakturahantering och Fortnox-export" },
  { title: "Fleethantering", url: "/fleet", icon: Fuel, description: "Fordonsöversikt, underhåll och bränsle" },
  { title: "Prediktiv Planering", url: "/predictive-planning", icon: TrendingUp, description: "AI-prognoser" },
];

const adminItems = [
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

interface NavDropdownProps {
  label: string;
  items: typeof grunddataItems;
  icon: React.ElementType;
  colorClass: string;
}

function NavDropdown({ label, items, icon: Icon, colorClass }: NavDropdownProps) {
  const [location] = useLocation();
  const isActive = items.some((item) => item.url === location);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={`gap-2 ${isActive ? "bg-accent" : ""}`}
          data-testid={`nav-dropdown-${label.toLowerCase()}`}
        >
          <Icon className={`h-4 w-4 ${colorClass}`} />
          <span className="hidden lg:inline">{label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {items.map((item) => (
          <DropdownMenuItem key={item.url} asChild>
            <Link
              href={item.url}
              className={`flex items-start gap-3 p-3 cursor-pointer ${
                location === item.url ? "bg-accent" : ""
              }`}
              data-testid={`nav-${item.url.replace("/", "") || "home"}`}
            >
              <item.icon className={`h-5 w-5 mt-0.5 ${colorClass}`} />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.description}</span>
              </div>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GlobalSearch() {
  const { companyName } = useTenantBranding();
  const openCommandPalette = () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <Button
      variant="outline"
      className="w-64 justify-start text-muted-foreground gap-2"
      onClick={openCommandPalette}
      data-testid="button-global-search"
    >
      <Search className="h-4 w-4" />
      <span className="hidden sm:inline">Sök i {companyName}...</span>
      <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-xs font-medium opacity-100 sm:flex">
        ⌘K
      </kbd>
    </Button>
  );
}

function UserMenu() {
  const { user } = useAuth();

  const displayName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.email || "Användare";

  const initials =
    user?.firstName && user?.lastName
      ? `${user.firstName[0]}${user.lastName[0]}`
      : user?.email?.[0]?.toUpperCase() || "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 pl-2 pr-3" data-testid="button-user-menu">
          <Avatar className="h-8 w-8">
            {user?.profileImageUrl && (
              <AvatarImage src={user.profileImageUrl} alt={displayName} />
            )}
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="hidden md:flex flex-col items-start">
            <span className="text-sm font-medium" data-testid="text-user-name">
              {displayName}
            </span>
            <span className="text-xs text-muted-foreground">{getRoleLabel(user?.role || "user")}</span>
          </div>
          <ChevronDown className="h-3 w-3 opacity-50 hidden md:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-3 py-2 border-b">
          <p className="text-sm font-medium">{displayName}</p>
          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer" data-testid="nav-settings-menu">
            <Settings className="h-4 w-4 mr-2" />
            Inställningar
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/api/logout" className="cursor-pointer text-destructive" data-testid="button-logout">
            <LogOut className="h-4 w-4 mr-2" />
            Logga ut
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TransparentLogo({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [lightSrc, setLightSrc] = useState<string | null>(null);
  const [darkSrc, setDarkSrc] = useState<string | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const original = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const lightData = new ImageData(new Uint8ClampedArray(original.data), canvas.width, canvas.height);
      const ld = lightData.data;
      for (let i = 0; i < ld.length; i += 4) {
        const r = ld[i], g = ld[i + 1], b = ld[i + 2];
        if (r > 220 && g > 220 && b > 220) {
          ld[i + 3] = 0;
        } else if (r > 200 && g > 200 && b > 200) {
          ld[i + 3] = Math.round(255 * (1 - (r + g + b - 600) / (765 - 600)));
        }
      }
      ctx.putImageData(lightData, 0, 0);
      setLightSrc(canvas.toDataURL("image/png"));

      const darkData = new ImageData(new Uint8ClampedArray(original.data), canvas.width, canvas.height);
      const dd = darkData.data;
      for (let i = 0; i < dd.length; i += 4) {
        const r = dd[i], g = dd[i + 1], b = dd[i + 2];
        if (r > 220 && g > 220 && b > 220) {
          dd[i + 3] = 0;
        } else if (r > 200 && g > 200 && b > 200) {
          dd[i + 3] = Math.round(255 * (1 - (r + g + b - 600) / (765 - 600)));
        } else {
          dd[i] = Math.min(255, r + 140);
          dd[i + 1] = Math.min(255, g + 140);
          dd[i + 2] = Math.min(255, b + 140);
        }
      }
      ctx.putImageData(darkData, 0, 0);
      setDarkSrc(canvas.toDataURL("image/png"));
    };
    img.src = src;
  }, [src]);

  return (
    <>
      <img
        src={lightSrc || src}
        alt={alt}
        className={`${className} dark:hidden`}
        data-testid="img-tenant-logo"
      />
      <img
        src={darkSrc || src}
        alt={alt}
        className={`${className} hidden dark:block`}
        data-testid="img-tenant-logo-dark"
      />
    </>
  );
}

function TenantLogo() {
  const { logoIconUrl, companyName } = useTenantBranding();

  return (
    <Link href="/">
      <div className="flex items-center cursor-pointer hover-elevate rounded-md px-1 py-0.5">
        <TransparentLogo
          src={logoIconUrl || nordfieldLogo}
          alt={companyName}
          className="h-[78px] object-contain"
        />
      </div>
    </Link>
  );
}

export function TopNav() {
  const { user } = useAuth();
  const userRole = user?.role || "user";

  const menuGroups: { label: string; items: typeof grunddataItems; icon: React.ElementType; colorClass: string; group: NavMenuGroup }[] = [
    { label: "Grunddata", items: grunddataItems, icon: Database, group: "grunddata", colorClass: "text-blue-500" },
    { label: "Ordrar", items: ordrarItems, icon: ClipboardList, group: "ordrar", colorClass: "text-amber-500" },
    { label: "Planering & Karta", items: planeringItems, icon: Calendar, group: "planering", colorClass: "text-green-500" },
    { label: "Fält & Utförande", items: faltItems, icon: Smartphone, group: "falt", colorClass: "text-teal-500" },
    { label: "Analys", items: analysItems, icon: BarChart3, group: "analys", colorClass: "text-purple-500" },
    { label: "Administration", items: adminItems, icon: Settings, group: "admin", colorClass: "text-orange-500" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex items-center gap-4 md:gap-6">
          <MobileNav />
          <TenantLogo />

          <nav className="hidden md:flex items-center gap-1">
            <Link href="/">
              <Button
                variant="ghost"
                className="gap-2"
                data-testid="nav-home"
              >
                <Home className="h-4 w-4" />
                <span className="hidden lg:inline">Start</span>
              </Button>
            </Link>
            {menuGroups.map((menu) =>
              canAccessMenu(userRole, menu.group) ? (
                <NavDropdown
                  key={menu.label}
                  label={menu.label}
                  items={menu.items}
                  icon={menu.icon}
                  colorClass={menu.colorClass}
                />
              ) : null
            )}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden lg:block">
            <GlobalSearch />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            data-testid="button-search-mobile"
          >
            <Search className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="relative"
            data-testid="button-notifications"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" />
          </Button>

          <TourMenu />

          <GlobalAIButton />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
