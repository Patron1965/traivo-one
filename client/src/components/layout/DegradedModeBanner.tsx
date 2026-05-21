import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = "ok" | "degraded" | "down" | "not_configured";
type Severity = "critical" | "important" | "optional";

interface Integration {
  id: string;
  label: string;
  status: Status;
  severity: Severity;
  detail?: string;
  fallback?: string;
  lastCheckedAt: string;
}

interface Snapshot {
  overall: "ok" | "degraded";
  checkedAt: string;
  integrations: Integration[];
}

const DISMISS_KEY = "traivo-degraded-banner-dismissed-at";
const DISMISS_TTL_MS = 30 * 60 * 1000;

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = parseInt(raw, 10);
    return Number.isFinite(at) && Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function DegradedModeBanner() {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(isDismissed);

  const { data } = useQuery<Snapshot>({
    queryKey: ["/api/system/integrations/health"],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const degradedItems = useMemo(() => {
    if (!data) return [];
    return data.integrations.filter(
      (i) =>
        (i.severity === "critical" || i.severity === "important") &&
        (i.status === "down" || i.status === "degraded" || i.status === "not_configured")
    );
  }, [data]);

  // Driv banner direkt från degradedItems (inte från overall), så att även
  // important-degraderingar (OpenAI/Twilio/Resend/Fortnox) och `not_configured`
  // syns för operatören — inte bara hard-down på critical.
  if (!data || degradedItems.length === 0 || dismissed) {
    return null;
  }

  const critical = degradedItems.filter((i) => i.severity === "critical");
  const summary = critical.length
    ? `${critical.map((c) => c.label.split(" ")[0]).join(", ")} svarar inte just nu — vissa funktioner är begränsade`
    : `${degradedItems.length} integration${degradedItems.length === 1 ? "" : "er"} är degraderad${degradedItems.length === 1 ? "" : "e"}`;

  return (
    <div
      className="w-full border-b border-warning/40 bg-warning/10 text-warning-foreground"
      role="alert"
      data-testid="banner-degraded-mode"
    >
      <div className="max-w-screen-2xl mx-auto px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-warning" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" data-testid="text-degraded-summary">
              {summary}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1"
              onClick={() => setExpanded((v) => !v)}
              data-testid="button-degraded-expand"
            >
              {expanded ? "Dölj detaljer" : "Visa detaljer"}
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>
          {expanded && (
            <ul className="mt-2 space-y-1.5 text-xs" data-testid="list-degraded-integrations">
              {degradedItems.map((i) => (
                <li
                  key={i.id}
                  className="rounded border border-warning/30 bg-background/60 p-2"
                  data-testid={`item-degraded-${i.id}`}
                >
                  <div className="font-medium">{i.label}</div>
                  {i.detail && <div className="text-muted-foreground">{i.detail}</div>}
                  {i.fallback && (
                    <div className="mt-1">
                      <span className="font-medium">Fallback:</span> {i.fallback}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, String(Date.now()));
            } catch {}
            setDismissed(true);
          }}
          aria-label="Stäng"
          data-testid="button-degraded-dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
