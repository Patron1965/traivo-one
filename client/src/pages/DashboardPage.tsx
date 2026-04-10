import { useState, useCallback, type ReactNode } from "react";
import { Dashboard } from "@/components/Dashboard";
import { QuickStats } from "@/components/layout/QuickStats";
import { AnomalyAlerts } from "@/components/AnomalyAlerts";
import { PredictiveInsights } from "@/components/PredictiveInsights";
import { TodayOverview } from "@/components/dashboard/TodayOverview";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";
import { CapacityOverview } from "@/components/dashboard/CapacityOverview";
import { AutoDistributeToday } from "@/components/dashboard/AutoDistributeToday";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { enUS as enLocale } from "date-fns/locale";
import { useLanguage } from "@/hooks/use-language";
import { ChevronDown, ChevronUp, Eye, EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STORAGE_KEY = "traivo_dashboard_sections";

type SectionId =
  | "quickStats"
  | "quickActions"
  | "analytics"
  | "alerts"
  | "capacity"
  | "today"
  | "predictive"
  | "anomaly";

const ALL_SECTIONS: SectionId[] = [
  "quickStats",
  "quickActions",
  "analytics",
  "alerts",
  "capacity",
  "today",
  "predictive",
  "anomaly",
];

const SECTION_LABELS: Record<SectionId, string> = {
  quickStats: "Nyckeltal",
  quickActions: "Snabbåtgärder",
  analytics: "Analys & diagram",
  alerts: "Kräver uppmärksamhet",
  capacity: "Kapacitetsöversikt",
  today: "Dagens översikt",
  predictive: "Prediktiva insikter",
  anomaly: "Avvikelsevarningar",
};

function loadCollapsed(): Set<SectionId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as SectionId[]);
  } catch {
    return new Set();
  }
}

function saveCollapsed(set: Set<SectionId>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {}
}

function CollapsibleSection({
  id,
  label,
  collapsed,
  onToggle,
  children,
}: {
  id: SectionId;
  label: string;
  collapsed: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  return (
    <div data-testid={`section-${id}`}>
      <button
        onClick={() => onToggle(id)}
        className="flex items-center gap-2 w-full text-left group mb-1"
        data-testid={`button-toggle-section-${id}`}
      >
        <div className="flex items-center justify-center h-5 w-5 rounded text-muted-foreground group-hover:text-foreground transition-colors">
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </div>
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
          {label}
        </span>
        {collapsed && (
          <span className="text-[10px] text-muted-foreground/60 italic">
            (dold)
          </span>
        )}
      </button>
      {!collapsed && <div className="mt-1">{children}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { t: tl, language } = useLanguage();
  const dateLocale = language === "en" ? enLocale : sv;
  const today = new Date();
  const [collapsed, setCollapsed] = useState<Set<SectionId>>(loadCollapsed);

  const toggle = useCallback((id: SectionId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveCollapsed(next);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    const all = new Set(ALL_SECTIONS);
    saveCollapsed(all);
    setCollapsed(all);
  }, []);

  const expandAll = useCallback(() => {
    const empty = new Set<SectionId>();
    saveCollapsed(empty);
    setCollapsed(empty);
  }, []);

  const resetSections = useCallback(() => {
    expandAll();
  }, [expandAll]);

  const collapsedCount = collapsed.size;

  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 10) return tl("page.dashboard.morning");
    if (hour < 18) return tl("page.dashboard.hello");
    return tl("page.dashboard.evening");
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-dashboard-greeting">
            {getGreeting()}!
          </h1>
          <p className="text-muted-foreground">
            {format(today, "EEEE d MMMM yyyy", { locale: dateLocale })} - Traivo Dashboard
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={collapsedCount === ALL_SECTIONS.length ? expandAll : collapseAll}
                  className="gap-1.5 text-muted-foreground"
                  data-testid="button-toggle-all-sections"
                >
                  {collapsedCount === ALL_SECTIONS.length ? (
                    <>
                      <Eye className="h-4 w-4" />
                      <span className="hidden sm:inline">Visa alla</span>
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-4 w-4" />
                      <span className="hidden sm:inline">Dölj alla</span>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {collapsedCount === ALL_SECTIONS.length
                  ? "Visa alla sektioner"
                  : "Dölj alla sektioner"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {collapsedCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetSections}
                    className="gap-1.5 text-muted-foreground"
                    data-testid="button-reset-sections"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span className="hidden sm:inline">Återställ</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Visa alla sektioner igen</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <AutoDistributeToday />
        </div>
      </div>

      <CollapsibleSection
        id="quickStats"
        label={SECTION_LABELS.quickStats}
        collapsed={collapsed.has("quickStats")}
        onToggle={toggle}
      >
        <QuickStats />
      </CollapsibleSection>

      <CollapsibleSection
        id="quickActions"
        label={SECTION_LABELS.quickActions}
        collapsed={collapsed.has("quickActions")}
        onToggle={toggle}
      >
        <QuickActions />
      </CollapsibleSection>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CollapsibleSection
            id="analytics"
            label={SECTION_LABELS.analytics}
            collapsed={collapsed.has("analytics")}
            onToggle={toggle}
          >
            <Dashboard />
          </CollapsibleSection>
        </div>
        <div className="space-y-6">
          <CollapsibleSection
            id="alerts"
            label={SECTION_LABELS.alerts}
            collapsed={collapsed.has("alerts")}
            onToggle={toggle}
          >
            <DashboardAlerts />
          </CollapsibleSection>

          <CollapsibleSection
            id="capacity"
            label={SECTION_LABELS.capacity}
            collapsed={collapsed.has("capacity")}
            onToggle={toggle}
          >
            <CapacityOverview />
          </CollapsibleSection>

          <CollapsibleSection
            id="today"
            label={SECTION_LABELS.today}
            collapsed={collapsed.has("today")}
            onToggle={toggle}
          >
            <TodayOverview />
          </CollapsibleSection>

          <CollapsibleSection
            id="predictive"
            label={SECTION_LABELS.predictive}
            collapsed={collapsed.has("predictive")}
            onToggle={toggle}
          >
            <PredictiveInsights />
          </CollapsibleSection>

          <CollapsibleSection
            id="anomaly"
            label={SECTION_LABELS.anomaly}
            collapsed={collapsed.has("anomaly")}
            onToggle={toggle}
          >
            <AnomalyAlerts />
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
