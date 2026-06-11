import { Clock, Banknote, Wallet, ListChecks, Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatSekFromOre } from "@/lib/format";
import { formatHours, formatCount, type GridKpis } from "@/lib/rough-planning";

interface RoughSummaryCardProps {
  title: string;
  kpis: GridKpis;
  variant?: "filter" | "selection";
  testIdPrefix: string;
}

export function RoughSummaryCard({
  title,
  kpis,
  variant = "filter",
  testIdPrefix,
}: RoughSummaryCardProps) {
  const items = [
    {
      key: "prod",
      icon: Clock,
      label: "Produktionstid",
      value: formatHours(kpis.productionMinutes),
    },
    {
      key: "value",
      icon: Banknote,
      label: "Ordervärde",
      value: formatSekFromOre(kpis.value),
    },
    {
      key: "cost",
      icon: Wallet,
      label: "Kostnad",
      value: formatSekFromOre(kpis.cost),
    },
    {
      key: "tasks",
      icon: ListChecks,
      label: "Antal uppgifter",
      value: formatCount(kpis.taskCount),
    },
    {
      key: "objects",
      icon: Building2,
      label: "Antal objekt",
      value: formatCount(kpis.objectCount),
    },
  ];

  return (
    <Card
      className={cn(
        "h-full",
        variant === "selection" && "border-primary/40 bg-primary/[0.03]",
      )}
      data-testid={`card-${testIdPrefix}`}
    >
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-[11px] leading-tight">{item.label}</span>
                </div>
                <span
                  className="text-base font-semibold text-foreground tabular-nums"
                  data-testid={`text-${testIdPrefix}-${item.key}`}
                >
                  {item.value}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
