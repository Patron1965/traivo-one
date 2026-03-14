import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
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
  Database,
  BarChart3,
  Briefcase,
  Palette,
  Home,
  Network,
  Wrench,
  Plus,
  Search,
  Moon,
  Sun,
  History,
} from "lucide-react";

const allNavItems = [
  { title: "Start", url: "/", icon: Home, category: "Navigation", keywords: ["hem", "dashboard", "översikt"] },
  { title: "Mina uppgifter", url: "/home", icon: Home, category: "Navigation", keywords: ["tasks", "uppgifter", "todo"] },
  { title: "Objekt", url: "/objects", icon: Building2, category: "Grunddata", keywords: ["fastighet", "plats", "kund", "adress"] },
  { title: "Resurser", url: "/resources", icon: Users, category: "Grunddata", keywords: ["personal", "tekniker", "medarbetare"] },
  { title: "Fordon", url: "/vehicles", icon: Truck, category: "Grunddata", keywords: ["bil", "lastbil", "transport"] },
  { title: "Artiklar", url: "/articles", icon: Package, category: "Grunddata", keywords: ["produkt", "tjänst", "material"] },
  { title: "Kluster", url: "/clusters", icon: Target, category: "Grunddata", keywords: ["område", "zon", "geografisk"] },
  { title: "Veckoplanering", url: "/planner", icon: Calendar, category: "Planering", keywords: ["schema", "vecka", "planera"] },
  { title: "Orderstock", url: "/order-stock", icon: ClipboardList, category: "Planering", keywords: ["order", "beställning", "jobb"] },
  { title: "Mobilapp", url: "/mobile", icon: Smartphone, category: "Planering", keywords: ["fält", "tekniker", "app"] },
  { title: "Rutter", url: "/routes", icon: Map, category: "Planering", keywords: ["köra", "väg", "navigering"] },
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, category: "Analys", keywords: ["översikt", "statistik", "kpi"] },
  { title: "Ekonomi", url: "/economics", icon: DollarSign, category: "Analys", keywords: ["intäkter", "kostnader", "resultat"] },
  { title: "Prislistor", url: "/price-lists", icon: Receipt, category: "System", keywords: ["pris", "kostnad", "taxa"] },
  { title: "Abonnemang", url: "/subscriptions", icon: RefreshCw, category: "System", keywords: ["prenumeration", "återkommande"] },
  { title: "Fortnox", url: "/fortnox", icon: Receipt, category: "System", keywords: ["faktura", "bokföring", "export"] },
  { title: "Produktionsstyrning", url: "/planning-parameters", icon: Settings2, category: "System", keywords: ["sla", "tid", "parameter"] },
  { title: "Importera data", url: "/import", icon: Upload, category: "System", keywords: ["csv", "fil", "ladda upp"] },
  { title: "Arkitektur", url: "/architecture", icon: Network, category: "System", keywords: ["system", "teknisk", "dokumentation"] },
  { title: "Inställningar", url: "/settings", icon: Settings, category: "System", keywords: ["konfiguration", "preferens"] },
  { title: "Väderplanering", url: "/weather", icon: Cloud, category: "Avancerat", keywords: ["prognos", "regn", "sol"] },
  { title: "AI-optimering", url: "/optimization", icon: Sparkles, category: "Avancerat", keywords: ["automatisk", "smart", "maskinlärning"] },
  { title: "Auto-klustring", url: "/auto-cluster", icon: Layers, category: "Avancerat", keywords: ["automatisk", "områdesindelning"] },
  { title: "Prediktiv planering", url: "/predictive-planning", icon: TrendingUp, category: "Avancerat", keywords: ["prognos", "ai"] },
  { title: "Ställtidsanalys", url: "/setup-analysis", icon: Timer, category: "Avancerat", keywords: ["tid", "effektivitet"] },
  { title: "Metadata", url: "/metadata", icon: FileText, category: "Avancerat", keywords: ["fält", "anpassning"] },
  { title: "Upphandlingar", url: "/procurements", icon: Briefcase, category: "Avancerat", keywords: ["avtal", "kontrakt"] },
  { title: "Kundportal", url: "/customer-portal", icon: Building, category: "Avancerat", keywords: ["extern", "kund"] },
  { title: "Systemöversikt", url: "/system-overview", icon: Database, category: "Avancerat", keywords: ["data", "statistik"] },
  { title: "Admin", url: "/system-dashboard", icon: Palette, category: "Avancerat", keywords: ["varumärke", "roller", "användare"] },
];

const quickActions = [
  { title: "Skapa ny order", icon: Plus, action: "create-order", keywords: ["ny", "order", "beställning"] },
  { title: "Lägg till objekt", icon: Building2, action: "add-object", keywords: ["ny", "fastighet", "plats"] },
  { title: "Ny resurs", icon: Users, action: "add-resource", keywords: ["ny", "personal", "tekniker"] },
  { title: "Importera data", icon: Upload, action: "import", keywords: ["csv", "fil", "ladda"] },
];

interface CommandPaletteProps {
  onThemeToggle?: () => void;
  currentTheme?: string;
}

export function CommandPalette({ onThemeToggle, currentTheme }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const [recentItems, setRecentItems] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("traivo-recent-pages");
    if (stored) {
      try {
        setRecentItems(JSON.parse(stored));
      } catch {
        setRecentItems([]);
      }
    }
  }, []);

  const addToRecent = useCallback((url: string) => {
    setRecentItems((prev) => {
      const filtered = prev.filter((item) => item !== url);
      const updated = [url, ...filtered].slice(0, 5);
      localStorage.setItem("traivo-recent-pages", JSON.stringify(updated));
      return updated;
    });
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleNavigate = (url: string) => {
    addToRecent(url);
    setLocation(url);
    setOpen(false);
  };

  const handleAction = (action: string) => {
    switch (action) {
      case "create-order":
        setLocation("/order-stock");
        break;
      case "add-object":
        setLocation("/objects");
        break;
      case "add-resource":
        setLocation("/resources");
        break;
      case "import":
        setLocation("/import");
        break;
      case "toggle-theme":
        onThemeToggle?.();
        break;
    }
    setOpen(false);
  };

  const recentNavItems = recentItems
    .map((url) => allNavItems.find((item) => item.url === url))
    .filter(Boolean);

  const groupedItems = allNavItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, typeof allNavItems>);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Sök sidor, åtgärder..." data-testid="input-command-palette" />
      <CommandList>
        <CommandEmpty>Inga resultat hittades.</CommandEmpty>

        {recentNavItems.length > 0 && (
          <CommandGroup heading="Senaste">
            {recentNavItems.map((item) => item && (
              <CommandItem
                key={`recent-${item.url}`}
                value={`recent-${item.title}`}
                onSelect={() => handleNavigate(item.url)}
                className="gap-3"
                data-testid={`command-recent-${item.url.replace("/", "") || "home"}`}
              >
                <History className="h-4 w-4 text-muted-foreground" />
                <item.icon className="h-4 w-4" />
                <span>{item.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Snabbåtgärder">
          {quickActions.map((action) => (
            <CommandItem
              key={action.action}
              value={`action-${action.title} ${action.keywords.join(" ")}`}
              onSelect={() => handleAction(action.action)}
              className="gap-3"
              data-testid={`command-action-${action.action}`}
            >
              <action.icon className="h-4 w-4 text-primary" />
              <span>{action.title}</span>
            </CommandItem>
          ))}
          <CommandItem
            value="action-toggle-theme växla tema mörkt ljust"
            onSelect={() => handleAction("toggle-theme")}
            className="gap-3"
            data-testid="command-action-toggle-theme"
          >
            {currentTheme === "dark" ? (
              <Sun className="h-4 w-4 text-yellow-500" />
            ) : (
              <Moon className="h-4 w-4 text-blue-500" />
            )}
            <span>Växla tema</span>
            <CommandShortcut>⌘T</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {Object.entries(groupedItems).map(([category, items]) => (
          <CommandGroup key={category} heading={category}>
            {items.map((item) => (
              <CommandItem
                key={item.url}
                value={`${item.title} ${item.keywords.join(" ")}`}
                onSelect={() => handleNavigate(item.url)}
                className="gap-3"
                data-testid={`command-nav-${item.url.replace("/", "") || "home"}`}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const openCommandPalette = useCallback(() => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
  }, []);

  return { openCommandPalette };
}
