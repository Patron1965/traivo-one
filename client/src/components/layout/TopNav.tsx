import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useTenantBranding } from "@/components/TenantBrandingProvider";
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
  Sparkles,
  Brain,
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
  Search,
  Bell,
  ChevronDown,
  Database,
  BarChart3,
  BookOpen,
  Briefcase,
  History,
  Palette,
  Home,
  Network,
  Wrench,
  Presentation,
  MessageSquare,
  Leaf,
  MapPin,
  Fuel,
  ExternalLink,
} from "lucide-react";

const grunddataItems = [
  { title: "Objekt", url: "/objects", icon: Building2, description: "Fastigheter och platser" },
  { title: "Resurser", url: "/resources", icon: Users, description: "Personal" },
  { title: "Fordon", url: "/vehicles", icon: Truck, description: "Fordon" },
  { title: "Artiklar", url: "/articles", icon: Package, description: "Produkter och tjänster" },
  { title: "Kluster", url: "/clusters", icon: Target, description: "Arbetsområden" },
];

const planeringItems = [
  { title: "Veckoplanering", url: "/planner", icon: Calendar, description: "Planera veckans arbete" },
  { title: "AI Command Center", url: "/ai-command-center", icon: Brain, description: "Samlade AI-funktioner" },
  { title: "AI Planeringsassistent", url: "/ai-planning", icon: Sparkles, description: "AI-analys och optimering" },
  { title: "Orderkoncept", url: "/order-concepts", icon: Layers, description: "Intelligenta ordergeneratorer" },
  { title: "Uppgifter", url: "/assignments", icon: ClipboardList, description: "Genererade uppgifter" },
  { title: "Orderstock", url: "/order-stock", icon: Package, description: "Alla ordrar" },
  { title: "Mobilapp", url: "/mobile", icon: Smartphone, description: "Fältarbete" },
  { title: "Rutter", url: "/routes", icon: Map, description: "Körvägar" },
  { title: "Planerarvy Karta", url: "/planner-map", icon: MapPin, description: "Realtidskarta med förare och uppdrag" },
  { title: "Historisk Kartvy", url: "/historical-map", icon: History, description: "Spela upp rörelsemönster och utvärdera effektivitet" },
  { title: "Checklista-mallar", url: "/checklist-templates", icon: ClipboardList, description: "Inspektionsfrågor per artikeltyp" },
];

const analysItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, description: "Översikt och nyckeltal" },
  { title: "Ekonomi", url: "/economics", icon: DollarSign, description: "Intäkter och kostnader" },
  { title: "Fakturering", url: "/invoicing", icon: Receipt, description: "Fakturahantering och Fortnox-export" },
  { title: "Fleethantering", url: "/fleet", icon: Fuel, description: "Fordonsöversikt, underhåll och bränsle" },
  { title: "Miljöcertifikat", url: "/environmental-certificates", icon: Leaf, description: "Årliga hållbarhetsrapporter" },
];

const systemItems = [
  { title: "Prislistor", url: "/price-lists", icon: Receipt, description: "Prissättning" },
  { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw, description: "Återkommande tjänster" },
  { title: "Fortnox", url: "/fortnox", icon: Receipt, description: "Fakturaexport" },
  { title: "SMS-inställningar", url: "/sms-settings", icon: MessageSquare, description: "SMS-notifikationer" },
  { title: "Produktionsstyrning", url: "/planning-parameters", icon: Settings2, description: "SLA och tider" },
  { title: "Importera data", url: "/import", icon: Upload, description: "Importera från fil" },
  { title: "Arkitektur", url: "/architecture", icon: Network, description: "Systemöversikt" },
  { title: "Användarhantering", url: "/user-management", icon: Users, description: "Hantera användare och roller" },
  { title: "Tenant-konfiguration", url: "/tenant-config", icon: Settings2, description: "Företag, artiklar, koder" },
  { title: "Inställningar", url: "/settings", icon: Settings, description: "Systeminställningar" },
];

const avanceratItems = [
  { title: "Arbetsflödesguide", url: "/workflow-guide", icon: BookOpen, description: "Hur systemet används" },
  { title: "Datakrav för import", url: "/data-requirements", icon: FileText, description: "Specifikation för Kinab" },
  { title: "Väderplanering", url: "/weather", icon: Cloud, description: "Planera efter väder" },
  { title: "AI-optimering", url: "/optimization", icon: Sparkles, description: "Automatisk optimering" },
  { title: "Auto-klustring", url: "/auto-cluster", icon: Layers, description: "Automatisk områdesindelning" },
  { title: "Prediktiv planering", url: "/predictive-planning", icon: TrendingUp, description: "AI-prognoser" },
  { title: "Ställtidsanalys", url: "/setup-analysis", icon: Timer, description: "Tidsanalys" },
  { title: "Metadatainställningar", url: "/metadata-settings", icon: Database, description: "Metadatakatalog" },
  { title: "Upphandlingar", url: "/procurements", icon: Briefcase, description: "Avtalshantering" },
  { title: "Kundportal", url: "/customer-portal", icon: Building, description: "Extern kundvy" },
  { title: "Demo Kundportal", url: "/portal/demo", icon: ExternalLink, description: "Testa kundens vy" },
  { title: "Systemöversikt", url: "/system-overview", icon: FileText, description: "Datastatistik" },
  { title: "Branschpaket", url: "/industry-packages", icon: Package, description: "Fördefinierade mallar" },
  { title: "API-kostnader", url: "/api-costs", icon: BarChart3, description: "Övervakning av API-kostnader" },
  { title: "Admin", url: "/system-dashboard", icon: Palette, description: "Varumärke och roller" },
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
            <span className="text-xs text-muted-foreground">Planerare</span>
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

function TenantLogo() {
  const { logoIconUrl, companyName, primaryColor } = useTenantBranding();

  return (
    <Link href="/">
      <div className="flex items-center gap-2 cursor-pointer hover-elevate rounded-md px-2 py-1">
        {logoIconUrl ? (
          <img 
            src={logoIconUrl} 
            alt={companyName} 
            className="h-8 w-8 object-contain"
            data-testid="img-tenant-logo"
          />
        ) : (
          <div 
            className="h-8 w-8 rounded-md flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: primaryColor }}
            data-testid="img-tenant-logo-fallback"
          >
            {companyName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="hidden lg:block font-semibold text-sm" data-testid="text-tenant-name">
          {companyName}
        </span>
      </div>
    </Link>
  );
}

export function TopNav() {
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
            <NavDropdown
              label="Grunddata"
              items={grunddataItems}
              icon={Database}
              colorClass="text-blue-500"
            />
            <NavDropdown
              label="Planering"
              items={planeringItems}
              icon={Calendar}
              colorClass="text-green-500"
            />
            <NavDropdown
              label="Analys"
              items={analysItems}
              icon={BarChart3}
              colorClass="text-purple-500"
            />
            <NavDropdown
              label="System"
              items={systemItems}
              icon={Settings}
              colorClass="text-orange-500"
            />
            <NavDropdown
              label="Avancerat"
              items={avanceratItems}
              icon={Wrench}
              colorClass="text-gray-500"
            />
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
