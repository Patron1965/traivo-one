import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, X, Bot, Zap, Route, BarChart3, MapPin, Package, Users, Calendar, Settings, Truck, FileText, DollarSign, Cloud, Clock, TrendingUp, Lightbulb } from "lucide-react";
import { AISuggestionsPanel } from "./AISuggestionsPanel";
import { format, startOfWeek, endOfWeek } from "date-fns";

type ModuleType = "week-planner" | "clusters" | "order-stock" | "resources" | "routes" | "dashboard" | "economics" | "optimization" | "objects" | "vehicles" | "weather" | "general";

interface PageContext {
  module: ModuleType;
  title: string;
  icon: typeof Sparkles;
  description: string;
  aiCapabilities: string[];
}

function getPageContext(location: string): PageContext {
  if (location === "/" || location === "/planner" || location === "/week-planner") {
    return {
      module: "week-planner",
      title: "Veckoplanering",
      icon: Calendar,
      description: "AI-schemaläggning och optimering",
      aiCapabilities: ["Auto-schemaläggning", "Ruttoptimering", "Arbetsbelastningsanalys", "Förslag"],
    };
  }
  
  if (location.startsWith("/clusters")) {
    return {
      module: "clusters",
      title: "Kluster",
      icon: MapPin,
      description: "AI-analys av kluster",
      aiCapabilities: ["Klusteroptimering", "Geografisk analys", "Kapacitetsförslag"],
    };
  }
  
  if (location === "/order-stock") {
    return {
      module: "order-stock",
      title: "Orderlager",
      icon: Package,
      description: "AI-prioritering av ordrar",
      aiCapabilities: ["Prioriteringsförslag", "Batchoptimering", "Deadline-varningar"],
    };
  }
  
  if (location === "/resources") {
    return {
      module: "resources",
      title: "Resurser",
      icon: Users,
      description: "AI-resursanalys",
      aiCapabilities: ["Kapacitetsbalansering", "Kompetensoptimering", "Belastningsfördelning"],
    };
  }
  
  if (location === "/routes") {
    return {
      module: "routes",
      title: "Rutter",
      icon: Route,
      description: "AI-ruttoptimering",
      aiCapabilities: ["Ruttoptimering", "Körtidsminimering", "Bränslebesparingar"],
    };
  }
  
  if (location === "/dashboard") {
    return {
      module: "dashboard",
      title: "Dashboard",
      icon: BarChart3,
      description: "AI-insikter",
      aiCapabilities: ["KPI-analys", "Trendidentifiering", "Anomalidetektion"],
    };
  }
  
  if (location === "/economics") {
    return {
      module: "economics",
      title: "Ekonomi",
      icon: DollarSign,
      description: "AI-kostnadsanalys",
      aiCapabilities: ["Kostnadsoptimering", "Lönsamhetsanalys", "Budgetprognoser"],
    };
  }
  
  if (location === "/optimization") {
    return {
      module: "optimization",
      title: "Optimering",
      icon: Zap,
      description: "AI-driven optimering",
      aiCapabilities: ["Heloptimering", "Scenarioanalys", "Förbättringsförslag"],
    };
  }
  
  if (location === "/objects") {
    return {
      module: "objects",
      title: "Objekt",
      icon: FileText,
      description: "AI-objektanalys",
      aiCapabilities: ["Servicemönster", "Gruppering", "Underhållsprognoser"],
    };
  }
  
  if (location === "/vehicles") {
    return {
      module: "vehicles",
      title: "Fordon",
      icon: Truck,
      description: "AI-fordonsanalys",
      aiCapabilities: ["Underhållsprognoser", "Kapacitetsoptimering", "Bränsleeffektivitet"],
    };
  }
  
  if (location === "/weather") {
    return {
      module: "weather",
      title: "Väderplanering",
      icon: Cloud,
      description: "AI-väderoptimering",
      aiCapabilities: ["Väderprognos", "Kapacitetsanpassning", "Riskbedömning"],
    };
  }
  
  return {
    module: "general",
    title: "AI Assistent",
    icon: Bot,
    description: "AI-stöd för Unicorn",
    aiCapabilities: [],
  };
}

function ModulePlaceholder({ context }: { context: PageContext }) {
  return (
    <div className="p-4 space-y-4">
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-500/10 mb-3">
          <context.icon className="h-6 w-6 text-purple-500" />
        </div>
        <h3 className="font-medium text-sm mb-1">AI för {context.title}</h3>
        <p className="text-xs text-muted-foreground">
          {context.description}
        </p>
      </div>
      
      {context.aiCapabilities.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Tillgängliga AI-funktioner:</p>
          <div className="space-y-1.5">
            {context.aiCapabilities.map((capability, index) => (
              <div key={index} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                <Lightbulb className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                <span className="text-xs">{capability}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="pt-2 border-t">
        <p className="text-xs text-muted-foreground text-center">
          Gå till <span className="font-medium">Veckoplanering</span> för full AI-upplevelse med auto-schemaläggning
        </p>
      </div>
    </div>
  );
}

export function GlobalAIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();
  const [currentDate] = useState(new Date());

  const weekStart = format(startOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(currentDate, { weekStartsOn: 1 }), "yyyy-MM-dd");

  const context = getPageContext(location);
  const PageIcon = context.icon;

  useEffect(() => {
    setIsOpen(false);
  }, [location]);

  if (!isOpen) {
    return (
      <Button
        className="fixed bottom-6 right-6 shadow-lg z-50 gap-2"
        onClick={() => setIsOpen(true)}
        data-testid="button-global-ai-assistant"
      >
        <Sparkles className="h-4 w-4" />
        AI Assistent
      </Button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 max-h-[80vh] flex flex-col shadow-2xl rounded-lg overflow-hidden border bg-background">
      <CardHeader className="pb-2 bg-gradient-to-r from-purple-500/10 to-blue-500/10">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="p-1.5 rounded-md bg-purple-500/20">
              <Sparkles className="h-4 w-4 text-purple-500" />
            </div>
            AI Assistent
          </CardTitle>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setIsOpen(false)}
            data-testid="button-close-global-ai"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <PageIcon className="h-3.5 w-3.5" />
          <span>{context.title}</span>
          <span className="text-muted-foreground/50">|</span>
          <span>{context.description}</span>
        </div>
      </CardHeader>
      
      <div className="flex-1 overflow-auto">
        {context.module === "week-planner" ? (
          <AISuggestionsPanel
            weekStart={weekStart}
            weekEnd={weekEnd}
            onScheduleApplied={() => {}}
          />
        ) : (
          <ModulePlaceholder context={context} />
        )}
      </div>
    </div>
  );
}
