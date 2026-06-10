import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Target,
  Building2,
  RefreshCw,
  FileText,
  CheckCircle2,
  Receipt,
} from "lucide-react";

interface SnoretPipelineProps {
  title?: string;
  objectCount: number;
  subscriptionCount: number;
  activeOrders: number;
  completedOrders: number;
  invoicedOrders: number;
}

interface Step {
  label: string;
  value: number;
  icon: typeof Building2;
  bg: string;
  fg: string;
  testId: string;
}

export function SnoretPipeline({
  title = "Snöret - Flödet genom kunden",
  objectCount,
  subscriptionCount,
  activeOrders,
  completedOrders,
  invoicedOrders,
}: SnoretPipelineProps) {
  const steps: Step[] = [
    { label: "Objekt", value: objectCount, icon: Building2, bg: "bg-chart-1/15", fg: "text-chart-1", testId: "snoret-objects" },
    { label: "Abonnemang", value: subscriptionCount, icon: RefreshCw, bg: "bg-chart-4/15", fg: "text-chart-4", testId: "snoret-subscriptions" },
    { label: "Aktiva ordrar", value: activeOrders, icon: FileText, bg: "bg-chart-3/15", fg: "text-chart-3", testId: "snoret-active-orders" },
    { label: "Utförda", value: completedOrders, icon: CheckCircle2, bg: "bg-chart-2/15", fg: "text-chart-2", testId: "snoret-completed-orders" },
    { label: "Fakturerade", value: invoicedOrders, icon: Receipt, bg: "bg-chart-2/15", fg: "text-chart-2", testId: "snoret-invoiced-orders" },
  ];

  return (
    <Card data-testid="card-snoret">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 overflow-x-auto pb-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={step.label} className="flex items-center gap-4 flex-1 min-w-fit last:flex-none">
                <div className="flex flex-col items-center min-w-[120px]">
                  <div className={`p-4 rounded-full ${step.bg} mb-2`}>
                    <Icon className={`h-6 w-6 ${step.fg}`} />
                  </div>
                  <p className="font-medium" data-testid={`${step.testId}-value`}>{step.value}</p>
                  <p className="text-sm text-muted-foreground">{step.label}</p>
                </div>
                {index < steps.length - 1 && (
                  <div className="h-px flex-1 bg-border min-w-[40px]" />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
