// Task #1129: Informationspaket-träd på objektsidan.
//
// LÄSVY (ingen mutation): bläddringsbar katalog/filter-trädvy över objektets
// uppgifter — utförda (work_orders) och kommande (assignments) — med varje
// uppgifts informationspaket (inmatad metadata + foton) och faktureringskoppling.
// Grupperas på objekt, plats, orderreferens/orderkoncept eller kalkylerad
// utförandetid. Data hämtas från GET /api/objects/:id/info-package-tree och
// grupperas på klienten för omedelbar omgruppering utan ny hämtning.
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronRight,
  ChevronDown,
  Image as ImageIcon,
  Receipt,
  Package,
  MapPin,
  Clock,
  Layers,
  CalendarClock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { formatSekFromOre } from "@/lib/format";
import { formatHours } from "@/lib/rough-planning";

type GroupBy = "objekt" | "plats" | "orderkoncept" | "utforandetid";

interface InvoiceConnection {
  category: string;
  label: string;
  detail: string | null;
  zeroInvoice: boolean;
  conceptId: string | null;
  conceptName: string | null;
}

interface MetadataEntry {
  label: string;
  value: string;
}

interface PhotoEntry {
  url: string;
  description: string | null;
}

interface InfoPackageNode {
  id: string;
  source: "work_order" | "assignment";
  kind: "historik" | "kommande";
  title: string | null;
  status: string;
  statusLabel: string;
  taskType: string;
  taskTypeLabel: string;
  executionCode: string | null;
  objectId: string | null;
  objectName: string | null;
  location: string | null;
  city: string | null;
  scheduledDate: string | null;
  productionMinutes: number;
  value: number;
  cost: number;
  orderConceptId: string | null;
  orderConceptName: string | null;
  customerName: string | null;
  invoice: InvoiceConnection;
  metadata: MetadataEntry[];
  photos: PhotoEntry[];
}

interface InfoPackageTreeResult {
  nodes: InfoPackageNode[];
  objectCount: number;
  includeChildren: boolean;
  truncated: boolean;
}

const GROUP_OPTIONS: { value: GroupBy; label: string; icon: typeof Package }[] = [
  { value: "objekt", label: "Objekt", icon: Package },
  { value: "plats", label: "Plats", icon: MapPin },
  { value: "orderkoncept", label: "Orderreferens", icon: Layers },
  { value: "utforandetid", label: "Utförandetid", icon: Clock },
];

function executionTimeBucket(minutes: number): { key: string; label: string; order: number } {
  if (!minutes || minutes <= 0) return { key: "0", label: "Ingen kalkylerad tid", order: 0 };
  if (minutes < 30) return { key: "lt30", label: "Under 30 min", order: 1 };
  if (minutes < 60) return { key: "30-60", label: "30–60 min", order: 2 };
  if (minutes < 120) return { key: "1-2h", label: "1–2 tim", order: 3 };
  if (minutes < 240) return { key: "2-4h", label: "2–4 tim", order: 4 };
  return { key: "4h+", label: "4+ tim", order: 5 };
}

function groupKeyFor(node: InfoPackageNode, groupBy: GroupBy): { key: string; label: string; order: number } {
  switch (groupBy) {
    case "objekt":
      return { key: node.objectId ?? "_", label: node.objectName ?? "Okänt objekt", order: 0 };
    case "plats": {
      const loc = [node.location, node.city].filter(Boolean).join(", ");
      return { key: loc || "_", label: loc || "Ingen plats", order: 0 };
    }
    case "orderkoncept":
      return {
        key: node.orderConceptId ?? "_fritt",
        label: node.orderConceptName ?? "Utan orderkoncept (fritt)",
        order: node.orderConceptId ? 1 : 0,
      };
    case "utforandetid":
      return executionTimeBucket(node.productionMinutes);
  }
}

function invoiceBadgeClass(category: string): string {
  switch (category) {
    case "abonnemang":
      return "border-chart-4/40 text-chart-4";
    case "fakturareferens":
      return "border-primary/40 text-primary";
    case "lopande":
      return "border-chart-2/40 text-chart-2";
    case "objekt_orderkoncept":
      return "border-chart-3/40 text-chart-3";
    default:
      return "border-muted-foreground/30 text-muted-foreground";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("sv-SE") : "—";
}

function TaskNodeRow({ node }: { node: InfoPackageNode }) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const hasPackage = node.metadata.length > 0 || node.photos.length > 0;
  // Endast utförda arbetsorder har en detaljvy; kommande assignments saknar sida.
  const canOpenDetail = node.source === "work_order";

  // Klick på själva raden öppnar arbetsordern (endast utförda work_orders).
  // Kommande assignments saknar detaljsida, så där fäller raden istället ut paketet.
  const handleRowClick = () => {
    if (canOpenDetail) {
      navigate(`/work-orders/${node.id}`);
    } else {
      setOpen((o) => !o);
    }
  };

  return (
    <div className="border-b last:border-b-0" data-testid={`info-package-node-${node.id}`}>
      <div className="flex items-start gap-1 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="pt-0.5 shrink-0 rounded-md hover-elevate"
          title={open ? "Dölj informationspaket" : "Visa informationspaket"}
          aria-label={open ? "Dölj informationspaket" : "Visa informationspaket"}
          aria-expanded={open}
          data-testid={`button-toggle-node-${node.id}`}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={handleRowClick}
          className="flex-1 min-w-0 flex items-start gap-3 text-left rounded-md hover-elevate"
          title={canOpenDetail ? "Öppna arbetsorder" : undefined}
          data-testid={`button-node-${node.id}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {node.kind === "kommande" ? (
                <CalendarClock className="h-4 w-4 text-chart-4 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="font-medium text-sm truncate" data-testid={`text-node-title-${node.id}`}>
                {node.title || node.taskTypeLabel}
              </span>
              <Badge variant="secondary" className="text-xs">
                {node.statusLabel}
              </Badge>
              {node.executionCode && (
                <Badge variant="outline" className="text-xs font-mono">
                  {node.executionCode}
                </Badge>
              )}
              {canOpenDetail && (
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span>{node.taskTypeLabel}</span>
              <span>·</span>
              <span>{formatDate(node.scheduledDate)}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatHours(node.productionMinutes)}
              </span>
              <span>·</span>
              <span>{formatSekFromOre(node.value)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge
              variant="outline"
              className={`text-xs gap-1 ${invoiceBadgeClass(node.invoice.category)}`}
              data-testid={`badge-invoice-${node.id}`}
            >
              <Receipt className="h-3 w-3" />
              {node.invoice.label}
            </Badge>
            {node.photos.length > 0 && (
              <Badge variant="secondary" className="text-xs gap-1">
                <ImageIcon className="h-3 w-3" />
                {node.photos.length}
              </Badge>
            )}
          </div>
        </button>
      </div>

      {open && (
        <div className="px-10 pb-4 pt-1 space-y-4" data-testid={`panel-node-${node.id}`}>
          {/* Faktureringskoppling */}
          <div className="text-xs">
            <div className="font-medium text-muted-foreground mb-1 uppercase tracking-wide">
              Faktureringskoppling
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`gap-1 ${invoiceBadgeClass(node.invoice.category)}`}>
                <Receipt className="h-3 w-3" />
                {node.invoice.label}
              </Badge>
              {node.invoice.zeroInvoice && (
                <Badge variant="secondary" className="text-xs">
                  0-faktura
                </Badge>
              )}
            </div>
            {node.invoice.detail && (
              <p className="mt-1 text-muted-foreground">{node.invoice.detail}</p>
            )}
            {node.invoice.conceptName && (
              <p className="mt-0.5 text-muted-foreground">
                Orderkoncept: <span className="text-foreground">{node.invoice.conceptName}</span>
              </p>
            )}
            {node.customerName && (
              <p className="mt-0.5 text-muted-foreground">
                Kund: <span className="text-foreground">{node.customerName}</span>
              </p>
            )}
          </div>

          {/* Informationspaket — inmatad metadata */}
          {node.metadata.length > 0 && (
            <div className="text-xs">
              <div className="font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                Inmatad metadata
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {node.metadata.map((m, i) => (
                  <div key={`${m.label}-${i}`} className="flex gap-2" data-testid={`meta-${node.id}-${i}`}>
                    <dt className="text-muted-foreground shrink-0">{m.label}:</dt>
                    <dd className="text-foreground break-words">{m.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Informationspaket — foton */}
          {node.photos.length > 0 && (
            <div className="text-xs">
              <div className="font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                Foton
              </div>
              <div className="flex flex-wrap gap-2">
                {node.photos.map((p, i) => (
                  <a
                    key={`${p.url}-${i}`}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                    data-testid={`photo-${node.id}-${i}`}
                  >
                    <img
                      src={p.url}
                      alt={p.description ?? "Foto"}
                      loading="lazy"
                      className="h-20 w-20 object-cover rounded-md border"
                    />
                    {p.description && (
                      <span className="block mt-0.5 text-[10px] text-muted-foreground text-center truncate w-20">
                        {p.description}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {!hasPackage && (
            <p className="text-xs text-muted-foreground italic">
              Inget informationspaket registrerat ännu.
            </p>
          )}

          {canOpenDetail && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => navigate(`/work-orders/${node.id}`)}
              data-testid={`button-open-work-order-detail-${node.id}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Öppna arbetsorder
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function GroupSection({
  label,
  nodes,
  defaultOpen,
}: {
  label: string;
  nodes: InfoPackageNode[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const totalValue = nodes.reduce((s, n) => s + (n.value || 0), 0);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover-elevate text-left"
        data-testid={`button-group-${label}`}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-medium text-sm flex-1 truncate">{label}</span>
        <Badge variant="secondary" className="text-xs">
          {nodes.length} {nodes.length === 1 ? "uppgift" : "uppgifter"}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">{formatSekFromOre(totalValue)}</span>
      </button>
      {open && (
        <div>
          {nodes.map((n) => (
            <TaskNodeRow key={`${n.source}-${n.id}`} node={n} />
          ))}
        </div>
      )}
    </div>
  );
}

export function InfoPackageTree({ objectId }: { objectId: string }) {
  const [includeChildren, setIncludeChildren] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("objekt");

  const { data, isLoading, isError } = useQuery<InfoPackageTreeResult>({
    queryKey: ["/api/objects", objectId, "info-package-tree", includeChildren],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/objects/${objectId}/info-package-tree?includeChildren=${includeChildren}`,
      );
      return res.json();
    },
  });

  const groups = useMemo(() => {
    const nodes = data?.nodes ?? [];
    const map = new Map<string, { label: string; order: number; nodes: InfoPackageNode[] }>();
    for (const node of nodes) {
      const g = groupKeyFor(node, groupBy);
      const entry = map.get(g.key);
      if (entry) {
        entry.nodes.push(node);
      } else {
        map.set(g.key, { label: g.label, order: g.order, nodes: [node] });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label, "sv");
    });
  }, [data?.nodes, groupBy]);

  return (
    <div className="space-y-4">
      {/* Kontroller */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Gruppera på:</span>
          {GROUP_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <Button
                key={opt.value}
                type="button"
                size="sm"
                variant={groupBy === opt.value ? "default" : "outline"}
                onClick={() => setGroupBy(opt.value)}
                className="h-7 gap-1.5 text-xs"
                data-testid={`button-groupby-${opt.value}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {opt.label}
              </Button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="info-package-include-children"
            checked={includeChildren}
            onCheckedChange={setIncludeChildren}
            data-testid="switch-include-children"
          />
          <Label htmlFor="info-package-include-children" className="text-xs cursor-pointer">
            Inkludera underliggande objekt
          </Label>
        </div>
      </div>

      {data?.truncated && (
        <div className="mx-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
          <AlertCircle className="h-4 w-4 text-warning" />
          Visar ett begränsat urval — objektet har fler uppgifter än vad som visas här.
        </div>
      )}

      {/* Innehåll */}
      <div className="px-3 pb-3 space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-sm text-destructive py-6 justify-center">
            <AlertCircle className="h-4 w-4" /> Kunde inte ladda informationspaket-trädet.
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
            <Package className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">Inga uppgifter att visa för det här objektet.</p>
          </div>
        ) : (
          groups.map((g, idx) => (
            <GroupSection key={g.label} label={g.label} nodes={g.nodes} defaultOpen={idx === 0} />
          ))
        )}
      </div>
    </div>
  );
}
