import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Users,
  Building2,
  Truck,
  CalendarDays,
  CheckCircle2,
  ArrowRight,
  X,
  Rocket,
} from "lucide-react";

interface Customer {
  id: string;
}
interface ServiceObject {
  id: string;
}
interface Resource {
  id: string;
}

const DISMISS_KEY = "traivo-onboarding-dismissed";

interface OnboardingStep {
  number: number;
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  color: string;
  bgColor: string;
  checkFn: (counts: { customers: number; objects: number; resources: number }) => boolean;
}

const STEPS: OnboardingStep[] = [
  {
    number: 1,
    title: "Importera kunder",
    description: "Hämta kunddata från Fortnox eller lägg till manuellt",
    icon: Users,
    href: "/fortnox",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/40",
    checkFn: (c) => c.customers > 0,
  },
  {
    number: 2,
    title: "Skapa objekt",
    description: "Lägg till objekt och koppla till rätt kund",
    icon: Building2,
    href: "/objects",
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/40",
    checkFn: (c) => c.objects > 0,
  },
  {
    number: 3,
    title: "Lägg till resurser",
    description: "Registrera personal och fordon som ska utföra arbetet",
    icon: Truck,
    href: "/resources",
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-100 dark:bg-purple-900/40",
    checkFn: (c) => c.resources > 0,
  },
  {
    number: 4,
    title: "Börja planera",
    description: "Öppna veckoplaneraren och fördela arbete",
    icon: CalendarDays,
    href: "/planner",
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/40",
    checkFn: (c) => c.customers > 0 && c.objects > 0 && c.resources > 0,
  },
];

export function OnboardingGuide() {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(DISMISS_KEY) === "true";
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const { data: resources = [] } = useQuery<Resource[]>({
    queryKey: ["/api/resources"],
  });

  const counts = {
    customers: customers.length,
    objects: objects.length,
    resources: resources.length,
  };

  const completedSteps = STEPS.filter((s) => s.checkFn(counts)).length;
  const allDone = completedSteps === STEPS.length;

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  return (
    <Card
      className="mb-8 border-primary/20 bg-gradient-to-br from-primary/5 via-background to-primary/5"
      data-testid="card-onboarding-guide"
    >
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Rocket className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Kom igång med Traivo One</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-onboarding-progress">
                {allDone
                  ? "Alla steg klara — du är redo att köra!"
                  : `${completedSteps} av ${STEPS.length} steg klara`}
              </p>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleDismiss}
            className="shrink-0"
            data-testid="button-dismiss-onboarding"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => {
            const done = step.checkFn(counts);
            const Icon = step.icon;
            return (
              <Link key={step.number} href={step.href}>
                <div
                  className={`relative rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${
                    done
                      ? "bg-muted/40 border-muted"
                      : "bg-card border-border hover:border-primary/30"
                  }`}
                  data-testid={`onboarding-step-${step.number}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 rounded-lg ${step.bgColor}`}>
                      <Icon className={`h-5 w-5 ${step.color}`} />
                    </div>
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-xs font-medium tabular-nums"
                      >
                        Steg {step.number}
                      </Badge>
                    )}
                  </div>
                  <h3
                    className={`font-semibold text-sm mb-1 ${
                      done ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {step.title}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                  {!done && (
                    <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
                      Gå till
                      <ArrowRight className="h-3 w-3" />
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>

        {allDone && (
          <div className="mt-4 flex justify-center">
            <Button onClick={handleDismiss} data-testid="button-onboarding-complete">
              Jag har kommit igång — dölj guiden
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
