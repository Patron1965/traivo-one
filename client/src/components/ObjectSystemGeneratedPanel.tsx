import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ClipboardList, Star, AlertTriangle, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

interface WorkOrderRow {
  id: string;
  orderNumber?: string | null;
  title?: string | null;
  status?: string | null;
  scheduledDate?: string | null;
  lineCount?: number;
}
interface RatingRow {
  id: string;
  rating: number;
  comment?: string | null;
  resourceName?: string | null;
  createdAt?: string | null;
}
interface IssueRow {
  id: string;
  description?: string | null;
  status?: string | null;
  createdAt?: string | null;
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  testId: string;
  children: React.ReactNode;
  onOpen: () => void;
  isLoading: boolean;
}

function Section({ title, icon, count, testId, children, onOpen, isLoading }: SectionProps) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={(v) => { setOpen(v); if (v) onOpen(); }}
    >
      <CollapsibleTrigger
        className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
        data-testid={`trigger-${testId}`}
      >
        <span className="flex items-center gap-2 font-medium">
          {icon}
          {title}
          {typeof count === "number" && <Badge variant="secondary" className="text-xs">{count}</Badge>}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-1 py-2">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Laddar...
          </div>
        ) : children}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface Props {
  objectId: string;
}

export function ObjectSystemGeneratedPanel({ objectId }: Props) {
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ratingsOpen, setRatingsOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);

  const orders = useQuery<WorkOrderRow[]>({
    queryKey: ["/api/objects", objectId, "work-orders"],
    enabled: !!objectId && ordersOpen,
  });
  const ratings = useQuery<RatingRow[]>({
    queryKey: ["/api/objects", objectId, "ratings"],
    enabled: !!objectId && ratingsOpen,
  });
  const issues = useQuery<IssueRow[]>({
    queryKey: ["/api/objects", objectId, "issue-reports"],
    enabled: !!objectId && issuesOpen,
  });

  return (
    <div className="space-y-2" data-testid="panel-system-generated">
      <Section
        title="Ordrar"
        icon={<ClipboardList className="h-4 w-4" />}
        count={orders.data?.length}
        testId="system-orders"
        onOpen={() => setOrdersOpen(true)}
        isLoading={orders.isLoading && ordersOpen}
      >
        {(orders.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground px-2" data-testid="text-no-orders">Inga ordrar.</p>
        ) : (
          <ul className="space-y-1">
            {orders.data!.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-accent" data-testid={`row-order-${o.id}`}>
                <span className="truncate">{o.orderNumber ? `#${o.orderNumber} · ` : ""}{o.title || "Order"}</span>
                <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  {typeof o.lineCount === "number" && <span className="text-xs">{o.lineCount} rader</span>}
                  {o.status && <Badge variant="outline" className="text-xs">{o.status}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Rating"
        icon={<Star className="h-4 w-4" />}
        count={ratings.data?.length}
        testId="system-ratings"
        onOpen={() => setRatingsOpen(true)}
        isLoading={ratings.isLoading && ratingsOpen}
      >
        {(ratings.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground px-2" data-testid="text-no-ratings">Inga betyg.</p>
        ) : (
          <ul className="space-y-1">
            {ratings.data!.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-accent" data-testid={`row-rating-${r.id}`}>
                <span className="min-w-0">
                  <span className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`h-3.5 w-3.5 ${i < r.rating ? "fill-warning text-warning" : "text-muted-foreground"}`} />
                    ))}
                    {r.resourceName && <span className="text-xs text-muted-foreground ml-1 truncate">{r.resourceName}</span>}
                  </span>
                  {r.comment && <span className="block text-xs text-muted-foreground truncate">{r.comment}</span>}
                </span>
                {r.createdAt && <span className="text-xs text-muted-foreground shrink-0">{new Date(r.createdAt).toLocaleDateString("sv-SE")}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Felanmälningar"
        icon={<AlertTriangle className="h-4 w-4" />}
        count={issues.data?.length}
        testId="system-issues"
        onOpen={() => setIssuesOpen(true)}
        isLoading={issues.isLoading && issuesOpen}
      >
        {(issues.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground px-2" data-testid="text-no-issues">Inga felanmälningar.</p>
        ) : (
          <ul className="space-y-1">
            {issues.data!.map((it) => (
              <li key={it.id} className="flex items-start justify-between gap-2 text-sm px-2 py-1 rounded hover:bg-accent" data-testid={`row-issue-${it.id}`}>
                <span className="truncate">{it.description || "Felanmälan"}</span>
                <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  {it.status && <Badge variant="outline" className="text-xs">{it.status}</Badge>}
                  {it.createdAt && <span className="text-xs">{new Date(it.createdAt).toLocaleDateString("sv-SE")}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
