import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ExternalLink, FileText, AlertTriangle, History, Tags } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { versionedUrl } from "@/lib/queryClient";
import { workOrderStatusBadge } from "@/lib/status-colors";
import type { ServiceObject } from "@shared/schema";

interface Props {
  object: ServiceObject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface MetadataEntry {
  source?: "local" | "inherited" | "computed" | "none";
  katalog?: { namn?: string; datatyp?: string; allowedValues?: string[] | null } | null;
  fromObject?: { namn?: string } | null;
  vardeString?: string | null;
  vardeInteger?: number | null;
  vardeDecimal?: number | null;
  vardeBoolean?: boolean | null;
  vardeDatetime?: string | null;
  vardeJson?: unknown | null;
}

interface DeviationItem {
  id: string;
  title: string;
  category: string;
  description?: string | null;
  severityLevel: string;
  status: string;
  reportedAt?: string | null;
  reportedByName?: string | null;
}

interface HistorikItem {
  id: string;
  katalogNamn?: string | null;
  gammaltVarde?: string | null;
  nyttVarde?: string | null;
  andradAv?: string | null;
  andradVid?: string | null;
  andringsMetod?: string | null;
}

interface WorkOrderItem {
  id: string;
  title?: string | null;
  orderNumber?: string | null;
  status?: string | null;
  scheduledDate?: string | Date | null;
}

function metadataValue(e: MetadataEntry): string {
  if (e.vardeString != null) return String(e.vardeString);
  if (e.vardeInteger != null) return String(e.vardeInteger);
  if (e.vardeDecimal != null) return String(e.vardeDecimal);
  if (e.vardeBoolean != null) return e.vardeBoolean ? "Ja" : "Nej";
  if (e.vardeDatetime != null) return String(e.vardeDatetime);
  if (e.vardeJson != null) return typeof e.vardeJson === "string" ? e.vardeJson : JSON.stringify(e.vardeJson);
  return "—";
}

function sourceBadge(source?: string, from?: string | null) {
  if (source === "computed") {
    return <Badge variant="secondary" className="text-xs bg-chart-4/15 text-chart-4 border border-chart-4/30">beräknat</Badge>;
  }
  if (source === "inherited") {
    return (
      <Badge variant="secondary" className="text-xs bg-chart-2/15 text-chart-2 border border-chart-2/30">
        ärvd ↓{from ? ` (${from})` : ""}
      </Badge>
    );
  }
  return <Badge variant="secondary" className="text-xs bg-chart-1/15 text-chart-1 border border-chart-1/30">eget</Badge>;
}

const severityBadge: Record<string, string> = {
  low: "bg-muted text-muted-foreground border border-border",
  medium: "bg-warning/15 text-warning border border-warning/30",
  high: "bg-destructive/15 text-destructive border border-destructive/30",
  critical: "bg-destructive/20 text-destructive border border-destructive/40",
};

function fmtDate(v?: string | Date | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("sv-SE");
}

export function ObjectDetailSheet({ object, open, onOpenChange }: Props) {
  const id = object?.id ?? null;

  const { data: displayNames } = useQuery<{ primary: string }>({
    queryKey: ["/api/objects", id, "display-names"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/objects/${id}/display-names`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!id && open,
    staleTime: 30000,
  });

  const { data: metaResp, isLoading: metaLoading } = useQuery<{ metadata: MetadataEntry[] }>({
    queryKey: ["/api/metadata/objects", id, "detail"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/metadata/objects/${id}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!id && open,
    staleTime: 15000,
  });

  const { data: workOrders = [], isLoading: woLoading } = useQuery<WorkOrderItem[]>({
    queryKey: ["/api/objects", id, "work-orders"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/objects/${id}/work-orders`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!id && open,
    staleTime: 15000,
  });

  const { data: deviations = [], isLoading: devLoading } = useQuery<DeviationItem[]>({
    queryKey: ["/api/objects", id, "deviations"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/objects/${id}/deviations`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!id && open,
    staleTime: 15000,
  });

  const { data: historik = [], isLoading: histLoading } = useQuery<HistorikItem[]>({
    queryKey: ["/api/metadata/objects", id, "historik"],
    queryFn: async () => {
      const res = await fetch(versionedUrl(`/api/metadata/objects/${id}/historik`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!id && open,
    staleTime: 15000,
  });

  const metadata = metaResp?.metadata ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0" data-testid="sheet-object-detail">
        <SheetHeader className="p-6 pb-3 border-b space-y-1">
          <SheetTitle className="truncate" data-testid="text-detail-name">
            {object?.name || object?.objectNumber || "Objekt"}
          </SheetTitle>
          <SheetDescription className="space-y-1">
            {object?.objectNumber && (
              <span className="font-mono text-xs" data-testid="text-detail-number">{object.objectNumber}</span>
            )}
            {displayNames?.primary && (
              <span className="block text-xs text-muted-foreground" data-testid="text-detail-breadcrumb">
                {displayNames.primary}
              </span>
            )}
          </SheetDescription>
          {id && (
            <div>
              <Button asChild variant="outline" size="sm" className="gap-1.5 mt-2">
                <Link href={`/objects/${id}`} data-testid="link-full-object-view">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Öppna fullständig vy
                </Link>
              </Button>
            </div>
          )}
        </SheetHeader>

        <Tabs defaultValue="metadata" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-6 mt-3 grid grid-cols-4">
            <TabsTrigger value="metadata" className="gap-1.5" data-testid="tab-metadata">
              <Tags className="h-3.5 w-3.5" /> Metadata
            </TabsTrigger>
            <TabsTrigger value="work-orders" className="gap-1.5" data-testid="tab-work-orders">
              <FileText className="h-3.5 w-3.5" /> Ordrar
            </TabsTrigger>
            <TabsTrigger value="deviations" className="gap-1.5" data-testid="tab-deviations">
              <AlertTriangle className="h-3.5 w-3.5" /> Avvik.
            </TabsTrigger>
            <TabsTrigger value="historik" className="gap-1.5" data-testid="tab-historik">
              <History className="h-3.5 w-3.5" /> Historik
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-6 pt-4">
              <TabsContent value="metadata" className="mt-0 space-y-2" data-testid="content-metadata">
                {metaLoading ? (
                  <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : metadata.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="empty-metadata">Inga metadatafält.</p>
                ) : (
                  metadata.map((e, i) => (
                    <div key={`${e.katalog?.namn}-${i}`} className="rounded-md border p-3 space-y-1" data-testid={`metadata-detail-${e.katalog?.namn}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{e.katalog?.namn}</span>
                        {sourceBadge(e.source, e.fromObject?.namn)}
                      </div>
                      <p className="text-sm text-muted-foreground break-words">{metadataValue(e)}</p>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="work-orders" className="mt-0 space-y-2" data-testid="content-work-orders">
                {woLoading ? (
                  <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : workOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="empty-work-orders">Inga arbetsordrar.</p>
                ) : (
                  workOrders.map((wo) => (
                    <div key={wo.id} className="rounded-md border p-3 flex items-center justify-between gap-2" data-testid={`work-order-${wo.id}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{wo.title || wo.orderNumber || "Arbetsorder"}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(wo.scheduledDate)}</p>
                      </div>
                      {wo.status && (
                        <Badge variant="secondary" className={`text-xs shrink-0 ${workOrderStatusBadge[wo.status] || ""}`}>
                          {wo.status}
                        </Badge>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="deviations" className="mt-0 space-y-2" data-testid="content-deviations">
                {devLoading ? (
                  <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : deviations.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="empty-deviations">Inga avvikelser.</p>
                ) : (
                  deviations.map((d) => (
                    <div key={d.id} className="rounded-md border p-3 space-y-1" data-testid={`deviation-${d.id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{d.title}</span>
                        <Badge variant="secondary" className={`text-xs shrink-0 ${severityBadge[d.severityLevel] || ""}`}>
                          {d.severityLevel}
                        </Badge>
                      </div>
                      {d.description && <p className="text-sm text-muted-foreground break-words">{d.description}</p>}
                      <p className="text-xs text-muted-foreground">{d.category} · {d.status} · {fmtDate(d.reportedAt)}</p>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="historik" className="mt-0 space-y-2" data-testid="content-historik">
                {histLoading ? (
                  <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : historik.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="empty-historik">Ingen historik.</p>
                ) : (
                  historik.map((h) => (
                    <div key={h.id} className="rounded-md border p-3 space-y-1" data-testid={`historik-${h.id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{h.katalogNamn || "Fält"}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{fmtDate(h.andradVid)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground break-words">
                        <span className="line-through opacity-60">{h.gammaltVarde || "—"}</span>
                        {" → "}
                        <span>{h.nyttVarde || "—"}</span>
                      </p>
                      {(h.andradAv || h.andringsMetod) && (
                        <p className="text-xs text-muted-foreground">
                          {[h.andradAv, h.andringsMetod].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
