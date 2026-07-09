import { Link } from "wouter";
import { CalendarDays, ArrowRight } from "lucide-react";

const primaryTools = [
  {
    title: "Uppgiftsnav",
    description:
      "Master: alla uppgifter från skapad till fakturerad. Sök, sortera och filtrera via filterbibliotek och tilldela till team.",
    icon: CalendarDays,
    href: "/grovplanering",
    testId: "hub-card-grovplanering",
  },
  {
    title: "Veckoplan",
    description:
      "Fin: 168-timmars veckoschema per team med ej planerade jobb, kalender, ruttoptimerad tur och summering.",
    icon: CalendarDays,
    href: "/veckoplan",
    testId: "hub-card-veckoplan",
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
            Välj planeringsvy nedan.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      </div>
    </div>
  );
}
