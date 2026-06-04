import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, MapPin, Navigation, Loader2, CheckCircle, ClipboardCheck,
  Building2, AlertTriangle, Inbox,
} from "lucide-react";
import { useTenantBranding } from "@/components/TenantBrandingProvider";
import { useToast } from "@/hooks/use-toast";

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

async function portalFetch(url: string, options: RequestInit = {}) {
  const token = getSessionToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_customer");
    localStorage.removeItem("portal_tenant");
    window.location.href = "/portal";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Något gick fel");
  }
  return res.json();
}

interface MetadataField {
  label: string;
  format: string | null;
  currentValue: string | null;
}

interface ExecutionTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  scheduledDate: string | null;
  object: {
    id: string;
    name: string;
    objectNumber: string | null;
    address: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  metadataFields: MetadataField[];
}

function mapUrl(obj: ExecutionTask["object"]): string | null {
  if (obj.latitude != null && obj.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${obj.latitude},${obj.longitude}`;
  }
  const addr = [obj.address, obj.city, obj.name].filter(Boolean).join(", ");
  if (addr) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  }
  return null;
}

function TaskCard({ task }: { task: ExecutionTask }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});

  const completeMutation = useMutation({
    mutationFn: async () => {
      const metadataUpdates = task.metadataFields
        .map((f) => ({ label: f.label, value: (values[f.label] ?? "").trim() }))
        .filter((u) => u.value.length > 0);
      return portalFetch(`/api/portal/execution/tasks/${task.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ metadataUpdates }),
      });
    },
    onSuccess: () => {
      toast({ title: "Uppgift kvitterad", description: "Uppgiften är markerad som utförd." });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/execution/tasks"] });
    },
    onError: (err: Error) => {
      toast({ title: "Kunde inte kvittera", description: err.message, variant: "destructive" });
    },
  });

  const url = mapUrl(task.object);

  return (
    <Card data-testid={`card-task-${task.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base leading-snug" data-testid={`text-task-title-${task.id}`}>
            {task.title}
          </CardTitle>
          <Badge variant="secondary" className="shrink-0">Att göra</Badge>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span data-testid={`text-task-object-${task.id}`}>
            {task.object.name}
            {task.object.objectNumber ? ` (${task.object.objectNumber})` : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {task.description && (
          <p className="text-sm text-foreground/90" data-testid={`text-task-desc-${task.id}`}>
            {task.description}
          </p>
        )}

        {(task.object.address || task.object.city) && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span>{[task.object.address, task.object.city].filter(Boolean).join(", ")}</span>
          </div>
        )}

        {url && (
          <Button
            variant="outline"
            size="sm"
            asChild
            data-testid={`link-task-map-${task.id}`}
          >
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Navigation className="h-4 w-4 mr-2" />
              Öppna i karta
            </a>
          </Button>
        )}

        {task.metadataFields.length > 0 && (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Metadata att uppdatera
            </p>
            {task.metadataFields.map((field) => (
              <div key={field.label} className="space-y-1.5">
                <Label htmlFor={`field-${task.id}-${field.label}`} className="text-sm">
                  {field.label}
                </Label>
                <Input
                  id={`field-${task.id}-${field.label}`}
                  value={values[field.label] ?? ""}
                  placeholder={field.currentValue ? `Nuvarande: ${field.currentValue}` : "Nytt värde"}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [field.label]: e.target.value }))
                  }
                  data-testid={`input-metadata-${task.id}-${field.label}`}
                />
                {field.currentValue && (
                  <p className="text-xs text-muted-foreground">
                    Nuvarande värde: {field.currentValue}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <Button
          className="w-full"
          onClick={() => completeMutation.mutate()}
          disabled={completeMutation.isPending}
          data-testid={`button-complete-${task.id}`}
        >
          {completeMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4 mr-2" />
          )}
          Kvittera uppgift
        </Button>
      </CardContent>
    </Card>
  );
}

export default function PortalExecutionPage() {
  const { companyName } = useTenantBranding();
  const [, setLocation] = useLocation();

  const tasksQuery = useQuery<ExecutionTask[]>({
    queryKey: ["/api/portal/execution/tasks"],
    queryFn: () => portalFetch("/api/portal/execution/tasks"),
    enabled: !!getSessionToken(),
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/portal/dashboard")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-base font-semibold leading-none" data-testid="text-page-title">
                Uppgifter
              </h1>
              <p className="text-xs text-muted-foreground">{companyName}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {tasksQuery.isLoading && (
          <div className="flex items-center justify-center py-16" data-testid="status-loading">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {tasksQuery.isError && (
          <Card data-testid="status-error">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="font-medium">Kunde inte hämta uppgifter</p>
              <p className="text-sm text-muted-foreground">
                {(tasksQuery.error as Error)?.message || "Försök igen senare."}
              </p>
              <Button variant="outline" size="sm" onClick={() => tasksQuery.refetch()} data-testid="button-retry">
                Försök igen
              </Button>
            </CardContent>
          </Card>
        )}

        {tasksQuery.isSuccess && tasksQuery.data.length === 0 && (
          <Card data-testid="status-empty">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Inga uppgifter just nu</p>
              <p className="text-sm text-muted-foreground">
                Här visas uppgifter för dina objekt som väntar på att kvitteras.
              </p>
            </CardContent>
          </Card>
        )}

        {tasksQuery.isSuccess &&
          tasksQuery.data.map((task) => <TaskCard key={task.id} task={task} />)}
      </main>
    </div>
  );
}
