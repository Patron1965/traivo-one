import { Link } from "wouter";
import {
  Calendar,
  CalendarDays,
  Gauge,
  Target,
  Globe,
  Map,
  MapPin,
  History,
  Settings2,
  Sliders,
  ListChecks,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const primaryTools = [
  {
    title: "Veckoplanering",
    description:
      "Drag-och-släpp schema för veckans arbete. Tilldela resurser, hantera prioriteringar och se beläggning i realtid.",
    icon: Calendar,
    href: "/planner",
    testId: "hub-card-planner",
  },
  {
    title: "Veckoplan (168h)",
    description:
      "Fullständigt 168-timmars schema per team och vecka. Detaljerad tidslinje med kapacitetsöversikt.",
    icon: CalendarDays,
    href: "/veckoplan",
    testId: "hub-card-veckoplan",
  },
  {
    title: "Grovplanering",
    description:
      "Veckoöversikt: behov vs kapacitet per team, ordervärde, status och geografisk fördelning per distrikt.",
    icon: CalendarDays,
    href: "/grovplanering",
    testId: "hub-card-grovplanering",
  },
];

const secondaryTools = [
  {
    title: "Kontrollpanel",
    description: "Heatmap med beläggning och SLA-risk",
    icon: Gauge,
    href: "/control-tower",
    testId: "hub-link-control-tower",
  },
  {
    title: "Produktionsledare",
    description: "Dagsproduktion, break-even och avvikelseprocess",
    icon: Target,
    href: "/enhetsansvarig",
    testId: "hub-link-enhetsansvarig",
  },
  {
    title: "Distrikt",
    description: "Geografiska distrikt och zoner (postnummer/polygon)",
    icon: Globe,
    href: "/distrikt",
    testId: "hub-link-distrikt",
  },
  {
    title: "Ruttplanering",
    description: "Optimera körvägar",
    icon: Map,
    href: "/routes",
    testId: "hub-link-routes",
  },
  {
    title: "Planerarvy Karta",
    description: "Realtidskarta med förare och uppdrag",
    icon: MapPin,
    href: "/planner-map",
    testId: "hub-link-planner-map",
  },
  {
    title: "Årsplanering",
    description: "Strategisk planering på årsnivå",
    icon: Calendar,
    href: "/annual-planning",
    testId: "hub-link-annual-planning",
  },
  {
    title: "Historisk Kartvy",
    description: "Spela upp rörelsemönster i efterhand",
    icon: History,
    href: "/historical-map",
    testId: "hub-link-historical-map",
  },
  {
    title: "Produktionsstyrning",
    description: "Planeringsinställningar och produktionsparametrar",
    icon: Settings2,
    href: "/planning-parameters",
    testId: "hub-link-planning-parameters",
  },
  {
    title: "Sökfilter",
    description: "Konfigurera sökfilter för planeraren",
    icon: Sliders,
    href: "/planner-search-filters",
    testId: "hub-link-planner-search-filters",
  },
  {
    title: "Utförandetyper",
    description: "Hantera utförandetyper och förberedelseuppgifter",
    icon: ListChecks,
    href: "/utforandetyper",
    testId: "hub-link-utforandetyper",
  },
];

export default function PlaneringsHubPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-planering-hub-title">
            Planering
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Välj planeringsvy eller öppna ett av verktygen nedan.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          {primaryTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link key={tool.href} href={tool.href}>
                <div
                  className="group relative flex flex-col gap-4 rounded-xl border bg-card p-6 cursor-pointer transition-all duration-150 hover:border-chart-2/60 hover:shadow-md hover:-translate-y-0.5"
                  data-testid={tool.testId}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-chart-2/10">
                      <Icon className="h-5 w-5 text-chart-2" />
                    </div>
                    <span className="font-semibold text-base leading-tight">{tool.title}</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                    {tool.description}
                  </p>
                  <div className="flex items-center text-xs font-medium text-chart-2 gap-1 mt-auto">
                    Öppna
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="border-t pt-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">
            Övriga verktyg
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {secondaryTools.map((tool) => {
              const Icon = tool.icon;
              return (
                <Link key={tool.href} href={tool.href}>
                  <div
                    className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 cursor-pointer transition-colors hover:bg-accent hover:border-border/80"
                    data-testid={tool.testId}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{tool.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
