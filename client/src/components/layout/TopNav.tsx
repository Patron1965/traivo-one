import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlobalAIButton } from "@/components/GlobalAIButton";
import { MobileNav } from "@/components/layout/MobileNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  HelpCircle,
  ChevronDown,
  Database,
  BarChart3,
  Briefcase,
  Palette,
} from "lucide-react";

const grunddataItems = [
  { title: "Kluster", url: "/clusters", icon: Target, description: "Geografiska arbetsområden" },
  { title: "Objekt", url: "/objects", icon: Building2, description: "Fastigheter och arbetsplatser" },
  { title: "Resurser", url: "/resources", icon: Users, description: "Personal och kompetenser" },
  { title: "Fordon", url: "/vehicles", icon: Truck, description: "Fordonspark och service" },
  { title: "Artiklar", url: "/articles", icon: Package, description: "Produktkatalog och lager" },
  { title: "Prislistor", url: "/price-lists", icon: Receipt, description: "Prissättning och avtal" },
  { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw, description: "Återkommande tjänster" },
];

const planeringItems = [
  { title: "Orderstock", url: "/order-stock", icon: ClipboardList, description: "Orderöversikt och hantering" },
  { title: "Veckoplanering", url: "/", icon: Calendar, description: "Detaljerad veckoplanering" },
  { title: "Väderplanering", url: "/weather", icon: Cloud, description: "Väderjusterad planering" },
  { title: "Inför Optimering", url: "/optimization", icon: Sparkles, description: "AI-driven optimering" },
  { title: "Ruttplanering", url: "/routes", icon: Map, description: "Effektiva rutter" },
  { title: "Mobilapp Fält", url: "/mobile", icon: Smartphone, description: "Fältarbete på mobil" },
];

const analysItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, description: "KPI:er och nyckeltal" },
  { title: "Ekonomi", url: "/economics", icon: DollarSign, description: "Ekonomisk rapportering" },
  { title: "Ställtidsanalys", url: "/setup-analysis", icon: Timer, description: "Tidsanalys och mönster" },
  { title: "Prediktiv Planering", url: "/predictive-planning", icon: TrendingUp, description: "AI-prognoser" },
];

const systemItems = [
  { title: "Produktionsstyrning", url: "/planning-parameters", icon: Settings2, description: "SLA och tidsfönster" },
  { title: "Auto-klustring", url: "/auto-cluster", icon: Layers, description: "Automatisk klusterbildning" },
  { title: "Metadata", url: "/metadata", icon: FileText, description: "Anpassade fält och arv" },
  { title: "Upphandlingar", url: "/procurements", icon: Briefcase, description: "Avtalshantering" },
  { title: "Kundportal", url: "/customer-portal", icon: Building, description: "Extern kundvy" },
  { title: "Fortnox", url: "/fortnox", icon: Receipt, description: "Fakturaexport och integration" },
  { title: "Importera data", url: "/import", icon: Upload, description: "Modus 2.0 import" },
  { title: "Systemöversikt", url: "/system-overview", icon: FileText, description: "Datastatistik" },
  { title: "Inställningar", url: "/settings", icon: Settings, description: "Systeminställningar" },
  { title: "Varumärke & Admin", url: "/system-dashboard", icon: Palette, description: "White-label och roller" },
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <Popover open={searchOpen} onOpenChange={setSearchOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-64 justify-start text-muted-foreground gap-2"
          data-testid="button-global-search"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Sök i Unicorn...</span>
          <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-xs font-medium opacity-100 sm:flex">
            ⌘K
          </kbd>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-3">
          <Input
            placeholder="Sök kunder, objekt, ordrar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
            autoFocus
            data-testid="input-global-search"
          />
        </div>
        {searchQuery && (
          <div className="border-t p-2">
            <p className="text-xs text-muted-foreground px-2 py-1">
              Sökfunktion kommer i nästa version
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
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

export function TopNav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex items-center gap-4 md:gap-6">
          <MobileNav />

          <nav className="hidden md:flex items-center gap-1">
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

          <Button
            variant="ghost"
            size="icon"
            className="hidden sm:flex"
            data-testid="button-help"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>

          <GlobalAIButton />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
