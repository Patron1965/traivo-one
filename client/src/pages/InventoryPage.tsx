import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Package,
  AlertTriangle,
  Pencil,
  ArrowLeftRight,
  PackagePlus,
  ClipboardList,
  Truck,
  Warehouse,
  Plus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface StockBalanceRow {
  id: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  location: string;
  balance: number;
  effectiveReorderPoint: number | null;
  safetyStock: number | null;
  isLow: boolean;
  updatedAt: string;
}

interface StockMovementRow {
  id: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  location: string;
  movementType: string;
  delta: number;
  balanceAfter: number;
  counterpartLocation: string | null;
  workOrderId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface StockLocationRow {
  id: string;
  name: string;
  kind: "main" | "vehicle";
  resourceId: string | null;
  teamId: string | null;
  isActive: boolean;
  notes: string | null;
  resourceName: string | null;
  teamName: string | null;
}

interface ReplenishmentRow {
  locationName: string;
  articleId: string;
  articleNumber: string;
  articleName: string;
  balance: number;
  effectiveReorderPoint: number;
  safetyStock: number | null;
  suggestedQuantity: number;
  sourceLocation: string | null;
}

interface ArticleLite {
  id: string;
  name: string;
  articleNumber: string | null;
  stockLocation: string | null;
}

interface ResourceLite {
  id: string;
  name: string;
}

interface TeamLite {
  id: string;
  name: string;
}

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  uttag: "Uttag",
  retur: "Retur",
  inleverans: "Inleverans",
  overforing_ut: "Överföring ut",
  overforing_in: "Överföring in",
  justering: "Justering",
  inventering: "Inventering",
};

function movementBadgeVariant(type: string): "default" | "secondary" | "destructive" | "outline" {
  if (type === "uttag" || type === "overforing_ut") return "outline";
  if (type === "inleverans" || type === "retur" || type === "overforing_in") return "secondary";
  return "default";
}

interface EditState {
  articleId: string;
  articleName: string;
  location: string;
  balance: string;
  reorderPoint: string;
}

interface LocationFormState {
  id: string | null;
  name: string;
  kind: "main" | "vehicle";
  resourceId: string;
  teamId: string;
  isActive: boolean;
  notes: string;
}

const EMPTY_LOCATION_FORM: LocationFormState = {
  id: null,
  name: "",
  kind: "main",
  resourceId: "",
  teamId: "",
  isActive: true,
  notes: "",
};

function invalidateInventory() {
  queryClient.invalidateQueries({ queryKey: ["/api/inventory/balances"] });
  queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
  queryClient.invalidateQueries({ queryKey: ["/api/inventory/movements"] });
  queryClient.invalidateQueries({ queryKey: ["/api/inventory/replenishment"] });
}

export default function InventoryPage() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [locationForm, setLocationForm] = useState<LocationFormState | null>(null);

  const [receiveState, setReceiveState] = useState({ articleId: "", location: "", quantity: "", note: "" });
  const [transferState, setTransferState] = useState({ articleId: "", fromLocation: "", toLocation: "", quantity: "", note: "" });
  const [countState, setCountState] = useState({ articleId: "", location: "", countedBalance: "", note: "" });

  const [movementArticleFilter, setMovementArticleFilter] = useState<string>("all");
  const [movementLocationFilter, setMovementLocationFilter] = useState<string>("all");

  const balancesQuery = useQuery<StockBalanceRow[]>({ queryKey: ["/api/inventory/balances"] });
  const locationsQuery = useQuery<StockLocationRow[]>({ queryKey: ["/api/inventory/locations"] });
  const replenishmentQuery = useQuery<ReplenishmentRow[]>({ queryKey: ["/api/inventory/replenishment"] });
  const { data: articles = [] } = useQuery<ArticleLite[]>({ queryKey: ["/api/articles"] });
  const { data: resources = [] } = useQuery<ResourceLite[]>({ queryKey: ["/api/resources"] });
  const { data: teams = [] } = useQuery<TeamLite[]>({ queryKey: ["/api/teams"] });

  const movementsQuery = useQuery<StockMovementRow[]>({
    queryKey: [
      "/api/inventory/movements",
      movementArticleFilter,
      movementLocationFilter,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (movementArticleFilter !== "all") params.set("articleId", movementArticleFilter);
      if (movementLocationFilter !== "all") params.set("location", movementLocationFilter);
      const qs = params.toString();
      const res = await fetch(`/api/inventory/movements${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta rörelser");
      return res.json();
    },
  });

  const balances = balancesQuery.data ?? [];
  const locations = locationsQuery.data ?? [];
  const movements = movementsQuery.data ?? [];
  const replenishment = replenishmentQuery.data ?? [];
  const lowStock = useMemo(() => balances.filter((b) => b.isLow), [balances]);

  // Lagerplats-alternativ: registrerade platser + fria platser som förekommer i saldon.
  const locationOptions = useMemo(() => {
    const names = new Set<string>();
    for (const l of locations) if (l.isActive) names.add(l.name);
    for (const b of balances) names.add(b.location);
    return Array.from(names).sort((a, b) => a.localeCompare(b, "sv"));
  }, [locations, balances]);

  const sortedArticles = useMemo(
    () => [...articles].sort((a, b) => a.name.localeCompare(b.name, "sv")),
    [articles],
  );

  const mutationError = (title: string) => (e: any) => {
    toast({ title, description: e?.message ?? "Ett fel uppstod", variant: "destructive" });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: { articleId: string; location: string; balance: number; reorderPoint: number | null }) =>
      apiRequest("PUT", "/api/inventory/balances", payload),
    onSuccess: () => {
      invalidateInventory();
      toast({ title: "Saldo uppdaterat" });
      setEditing(null);
    },
    onError: mutationError("Kunde inte uppdatera saldo"),
  });

  const receiveMutation = useMutation({
    mutationFn: async (payload: { articleId: string; location: string; quantity: number; note?: string }) =>
      apiRequest("POST", "/api/inventory/receive", payload),
    onSuccess: () => {
      invalidateInventory();
      toast({ title: "Inleverans registrerad" });
      setReceiveOpen(false);
      setReceiveState({ articleId: "", location: "", quantity: "", note: "" });
    },
    onError: mutationError("Kunde inte registrera inleverans"),
  });

  const transferMutation = useMutation({
    mutationFn: async (payload: { articleId: string; fromLocation: string; toLocation: string; quantity: number; note?: string }) =>
      apiRequest("POST", "/api/inventory/transfer", payload),
    onSuccess: () => {
      invalidateInventory();
      toast({ title: "Överföring genomförd" });
      setTransferOpen(false);
      setTransferState({ articleId: "", fromLocation: "", toLocation: "", quantity: "", note: "" });
    },
    onError: mutationError("Kunde inte genomföra överföringen"),
  });

  const countMutation = useMutation({
    mutationFn: async (payload: { articleId: string; location: string; countedBalance: number; note?: string }) =>
      apiRequest("POST", "/api/inventory/count", payload),
    onSuccess: async (res) => {
      const body = await res.json().catch(() => null);
      invalidateInventory();
      toast({
        title: "Inventering registrerad",
        description: body && typeof body.delta === "number"
          ? `Differens: ${body.delta > 0 ? "+" : ""}${body.delta}`
          : undefined,
      });
      setCountOpen(false);
      setCountState({ articleId: "", location: "", countedBalance: "", note: "" });
    },
    onError: mutationError("Kunde inte registrera inventeringen"),
  });

  const locationMutation = useMutation({
    mutationFn: async (form: LocationFormState) => {
      const payload = {
        name: form.name,
        kind: form.kind,
        resourceId: form.kind === "vehicle" && form.resourceId ? form.resourceId : null,
        teamId: form.kind === "vehicle" && form.teamId ? form.teamId : null,
        isActive: form.isActive,
        notes: form.notes.trim() || null,
      };
      return form.id
        ? apiRequest("PATCH", `/api/inventory/locations/${form.id}`, payload)
        : apiRequest("POST", "/api/inventory/locations", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/replenishment"] });
      toast({ title: "Lagerplats sparad" });
      setLocationForm(null);
    },
    onError: mutationError("Kunde inte spara lagerplatsen"),
  });

  const handleSaveBalance = () => {
    if (!editing) return;
    const balance = Number(editing.balance);
    if (!Number.isFinite(balance)) {
      toast({ title: "Ogiltigt saldo", variant: "destructive" });
      return;
    }
    const rp = editing.reorderPoint.trim();
    saveMutation.mutate({
      articleId: editing.articleId,
      location: editing.location,
      balance: Math.round(balance),
      reorderPoint: rp === "" ? null : Math.round(Number(rp)),
    });
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-auto">
      <div className="flex flex-col gap-4 mb-6">
        <PageHeader
          icon={Package}
          title="Lager"
          description="Lagersaldo, rörelselogg, lagerplatser och påfyllnad. Saldot dras automatiskt när fältpersonal registrerar taget antal — i första hand från servicebilens lager."
          testId="text-inventory-title"
        />
      </div>

      {lowStock.length > 0 && (
        <Alert variant="destructive" className="mb-4" data-testid="alert-low-stock">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Lågt lagersaldo</AlertTitle>
          <AlertDescription>
            {lowStock.length} artikel{lowStock.length === 1 ? "" : "-platser"} ligger på eller under beställningspunkten och behöver fyllas på.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="balances" className="flex-1 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <TabsList>
            <TabsTrigger value="balances" data-testid="tab-balances">Saldo</TabsTrigger>
            <TabsTrigger value="movements" data-testid="tab-movements">Rörelser</TabsTrigger>
            <TabsTrigger value="locations" data-testid="tab-locations">Lagerplatser</TabsTrigger>
            <TabsTrigger value="replenishment" data-testid="tab-replenishment">
              Påfyllnad
              {replenishment.length > 0 && (
                <Badge variant="destructive" className="ml-2">{replenishment.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setReceiveOpen(true)} data-testid="button-open-receive">
              <PackagePlus className="h-4 w-4 mr-2" />
              Inleverans
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)} data-testid="button-open-transfer">
              <ArrowLeftRight className="h-4 w-4 mr-2" />
              Överföring
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCountOpen(true)} data-testid="button-open-count">
              <ClipboardList className="h-4 w-4 mr-2" />
              Inventering
            </Button>
          </div>
        </div>

        <TabsContent value="balances" className="flex-1 mt-0">
          <Card className="flex-1">
            <CardContent className="p-0">
              <QueryState
                isLoading={balancesQuery.isLoading}
                isError={balancesQuery.isError}
                isEmpty={balances.length === 0}
                error={balancesQuery.error as any}
                onRetry={balancesQuery.refetch}
                loadingVariant="skeleton-rows"
                emptyTitle="Inga lagersaldon"
                emptyDescription="Saldon skapas automatiskt när artiklar med lagerplats plockas i fält, eller via Inleverans."
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artikel</TableHead>
                      <TableHead>Artikelnr</TableHead>
                      <TableHead>Lagerplats</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="text-right">Beställningspunkt</TableHead>
                      <TableHead className="text-right">Säkerhetslager</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Åtgärd</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balances.map((row) => (
                      <TableRow
                        key={row.id}
                        className={row.isLow ? "bg-destructive/5" : undefined}
                        data-testid={`row-balance-${row.id}`}
                      >
                        <TableCell className="font-medium" data-testid={`text-article-name-${row.id}`}>
                          {row.articleName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{row.articleNumber}</TableCell>
                        <TableCell data-testid={`text-location-${row.id}`}>{row.location}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${row.balance < 0 ? "text-destructive font-semibold" : ""}`}
                          data-testid={`text-balance-${row.id}`}
                        >
                          {row.balance}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.effectiveReorderPoint ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.safetyStock ?? "—"}
                        </TableCell>
                        <TableCell>
                          {row.isLow ? (
                            <Badge variant="destructive" data-testid={`badge-low-${row.id}`}>Lågt</Badge>
                          ) : (
                            <Badge variant="secondary">OK</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setEditing({
                                articleId: row.articleId,
                                articleName: row.articleName,
                                location: row.location,
                                balance: String(row.balance),
                                reorderPoint: row.effectiveReorderPoint == null ? "" : String(row.effectiveReorderPoint),
                              })
                            }
                            data-testid={`button-edit-${row.id}`}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Justera
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </QueryState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements" className="flex-1 mt-0">
          <Card className="flex-1">
            <CardContent className="p-0">
              <div className="flex flex-wrap gap-2 p-4 border-b">
                <Select value={movementArticleFilter} onValueChange={setMovementArticleFilter}>
                  <SelectTrigger className="w-[240px]" data-testid="select-movement-article">
                    <SelectValue placeholder="Alla artiklar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alla artiklar</SelectItem>
                    {sortedArticles.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={movementLocationFilter} onValueChange={setMovementLocationFilter}>
                  <SelectTrigger className="w-[200px]" data-testid="select-movement-location">
                    <SelectValue placeholder="Alla lagerplatser" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alla lagerplatser</SelectItem>
                    {locationOptions.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <QueryState
                isLoading={movementsQuery.isLoading}
                isError={movementsQuery.isError}
                isEmpty={movements.length === 0}
                error={movementsQuery.error as any}
                onRetry={movementsQuery.refetch}
                loadingVariant="skeleton-rows"
                emptyTitle="Inga lagerrörelser"
                emptyDescription="Rörelser loggas automatiskt vid uttag, retur, inleverans, överföring, justering och inventering."
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tid</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead>Artikel</TableHead>
                      <TableHead>Lagerplats</TableHead>
                      <TableHead className="text-right">Förändring</TableHead>
                      <TableHead className="text-right">Saldo efter</TableHead>
                      <TableHead>Motpart/Notering</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m) => (
                      <TableRow key={m.id} data-testid={`row-movement-${m.id}`}>
                        <TableCell className="text-muted-foreground whitespace-nowrap">{formatDate(m.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={movementBadgeVariant(m.movementType)} data-testid={`badge-movement-type-${m.id}`}>
                            {MOVEMENT_TYPE_LABELS[m.movementType] ?? m.movementType}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{m.articleName}</TableCell>
                        <TableCell>{m.location}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${m.delta < 0 ? "text-destructive" : "text-muted-foreground"}`}
                          data-testid={`text-movement-delta-${m.id}`}
                        >
                          {m.delta > 0 ? `+${m.delta}` : m.delta}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{m.balanceAfter}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {[m.counterpartLocation ? `↔ ${m.counterpartLocation}` : null, m.note].filter(Boolean).join(" · ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </QueryState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="locations" className="flex-1 mt-0">
          <Card className="flex-1">
            <CardContent className="p-0">
              <div className="flex justify-end p-4 border-b">
                <Button size="sm" onClick={() => setLocationForm({ ...EMPTY_LOCATION_FORM })} data-testid="button-new-location">
                  <Plus className="h-4 w-4 mr-2" />
                  Ny lagerplats
                </Button>
              </div>
              <QueryState
                isLoading={locationsQuery.isLoading}
                isError={locationsQuery.isError}
                isEmpty={locations.length === 0}
                error={locationsQuery.error as any}
                onRetry={locationsQuery.refetch}
                loadingVariant="skeleton-rows"
                emptyTitle="Inga lagerplatser"
                emptyDescription="Registrera huvudlager och servicebilar som lagerplatser. Bil-lager kopplas till resurs eller team så att fältuttag dras därifrån."
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Namn</TableHead>
                      <TableHead>Typ</TableHead>
                      <TableHead>Kopplad till</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Notering</TableHead>
                      <TableHead className="text-right">Åtgärd</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations.map((l) => (
                      <TableRow key={l.id} data-testid={`row-location-${l.id}`}>
                        <TableCell className="font-medium" data-testid={`text-location-name-${l.id}`}>{l.name}</TableCell>
                        <TableCell>
                          {l.kind === "vehicle" ? (
                            <Badge variant="outline"><Truck className="h-3 w-3 mr-1" />Servicebil</Badge>
                          ) : (
                            <Badge variant="secondary"><Warehouse className="h-3 w-3 mr-1" />Huvudlager</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {l.resourceName ?? l.teamName ?? "—"}
                        </TableCell>
                        <TableCell>
                          {l.isActive ? (
                            <Badge variant="secondary">Aktiv</Badge>
                          ) : (
                            <Badge variant="outline">Inaktiv</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{l.notes ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setLocationForm({
                                id: l.id,
                                name: l.name,
                                kind: l.kind,
                                resourceId: l.resourceId ?? "",
                                teamId: l.teamId ?? "",
                                isActive: l.isActive,
                                notes: l.notes ?? "",
                              })
                            }
                            data-testid={`button-edit-location-${l.id}`}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Redigera
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </QueryState>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="replenishment" className="flex-1 mt-0">
          <Card className="flex-1">
            <CardContent className="p-0">
              <QueryState
                isLoading={replenishmentQuery.isLoading}
                isError={replenishmentQuery.isError}
                isEmpty={replenishment.length === 0}
                error={replenishmentQuery.error as any}
                onRetry={replenishmentQuery.refetch}
                loadingVariant="skeleton-rows"
                emptyTitle="Inget att fylla på"
                emptyDescription="Alla servicebilars saldon ligger över beställningspunkten, eller så finns inga aktiva bil-lagerplatser med beställningspunkter."
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Servicebil</TableHead>
                      <TableHead>Artikel</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="text-right">Beställningspunkt</TableHead>
                      <TableHead className="text-right">Föreslagen påfyllnad</TableHead>
                      <TableHead>Från</TableHead>
                      <TableHead className="text-right">Åtgärd</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {replenishment.map((r, i) => (
                      <TableRow key={`${r.locationName}-${r.articleId}`} data-testid={`row-replenishment-${i}`}>
                        <TableCell className="font-medium">{r.locationName}</TableCell>
                        <TableCell>{r.articleName}</TableCell>
                        <TableCell className={`text-right tabular-nums ${r.balance < 0 ? "text-destructive font-semibold" : ""}`}>
                          {r.balance}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.effectiveReorderPoint}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold" data-testid={`text-suggested-${i}`}>
                          {r.suggestedQuantity}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.sourceLocation ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setTransferState({
                                articleId: r.articleId,
                                fromLocation: r.sourceLocation ?? "",
                                toLocation: r.locationName,
                                quantity: String(r.suggestedQuantity),
                                note: "Påfyllnad servicebil",
                              });
                              setTransferOpen(true);
                            }}
                            data-testid={`button-replenish-${i}`}
                          >
                            <ArrowLeftRight className="h-4 w-4 mr-2" />
                            Fyll på
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </QueryState>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Justera saldo */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Justera lagersaldo</DialogTitle>
            <DialogDescription>
              {editing?.articleName} — {editing?.location}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="balance">Saldo</Label>
                <Input
                  id="balance"
                  type="number"
                  value={editing.balance}
                  onChange={(e) => setEditing({ ...editing, balance: e.target.value })}
                  data-testid="input-balance"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reorderPoint">Beställningspunkt (valfritt)</Label>
                <Input
                  id="reorderPoint"
                  type="number"
                  value={editing.reorderPoint}
                  onChange={(e) => setEditing({ ...editing, reorderPoint: e.target.value })}
                  placeholder="Ärvs från artikeln om tomt"
                  data-testid="input-reorder-point"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} data-testid="button-cancel-edit">
              Avbryt
            </Button>
            <Button onClick={handleSaveBalance} disabled={saveMutation.isPending} data-testid="button-save-balance">
              {saveMutation.isPending ? "Sparar…" : "Spara"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inleverans */}
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inleverans</DialogTitle>
            <DialogDescription>Registrera mottagen leverans — saldot ökas på vald lagerplats.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Artikel</Label>
              <Select value={receiveState.articleId} onValueChange={(v) => {
                const art = articles.find((a) => a.id === v);
                setReceiveState((s) => ({
                  ...s,
                  articleId: v,
                  location: s.location || art?.stockLocation || "",
                }));
              }}>
                <SelectTrigger data-testid="select-receive-article">
                  <SelectValue placeholder="Välj artikel" />
                </SelectTrigger>
                <SelectContent>
                  {sortedArticles.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Lagerplats</Label>
              <Select value={receiveState.location} onValueChange={(v) => setReceiveState((s) => ({ ...s, location: v }))}>
                <SelectTrigger data-testid="select-receive-location">
                  <SelectValue placeholder="Välj lagerplats" />
                </SelectTrigger>
                <SelectContent>
                  {locationOptions.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="receive-qty">Antal</Label>
              <Input
                id="receive-qty"
                type="number"
                min={1}
                value={receiveState.quantity}
                onChange={(e) => setReceiveState((s) => ({ ...s, quantity: e.target.value }))}
                data-testid="input-receive-quantity"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="receive-note">Notering (valfritt)</Label>
              <Input
                id="receive-note"
                value={receiveState.note}
                onChange={(e) => setReceiveState((s) => ({ ...s, note: e.target.value }))}
                placeholder="T.ex. följesedel/ordernr"
                data-testid="input-receive-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveOpen(false)} data-testid="button-cancel-receive">
              Avbryt
            </Button>
            <Button
              disabled={
                receiveMutation.isPending ||
                !receiveState.articleId ||
                !receiveState.location ||
                !(Number(receiveState.quantity) > 0)
              }
              onClick={() =>
                receiveMutation.mutate({
                  articleId: receiveState.articleId,
                  location: receiveState.location,
                  quantity: Math.round(Number(receiveState.quantity)),
                  note: receiveState.note.trim() || undefined,
                })
              }
              data-testid="button-save-receive"
            >
              {receiveMutation.isPending ? "Sparar…" : "Registrera"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Överföring */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Överföring</DialogTitle>
            <DialogDescription>Flytta lager mellan två lagerplatser, t.ex. huvudlager till servicebil.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Artikel</Label>
              <Select value={transferState.articleId} onValueChange={(v) => setTransferState((s) => ({ ...s, articleId: v }))}>
                <SelectTrigger data-testid="select-transfer-article">
                  <SelectValue placeholder="Välj artikel" />
                </SelectTrigger>
                <SelectContent>
                  {sortedArticles.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Från</Label>
                <Select value={transferState.fromLocation} onValueChange={(v) => setTransferState((s) => ({ ...s, fromLocation: v }))}>
                  <SelectTrigger data-testid="select-transfer-from">
                    <SelectValue placeholder="Från-plats" />
                  </SelectTrigger>
                  <SelectContent>
                    {locationOptions.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Till</Label>
                <Select value={transferState.toLocation} onValueChange={(v) => setTransferState((s) => ({ ...s, toLocation: v }))}>
                  <SelectTrigger data-testid="select-transfer-to">
                    <SelectValue placeholder="Till-plats" />
                  </SelectTrigger>
                  <SelectContent>
                    {locationOptions.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="transfer-qty">Antal</Label>
              <Input
                id="transfer-qty"
                type="number"
                min={1}
                value={transferState.quantity}
                onChange={(e) => setTransferState((s) => ({ ...s, quantity: e.target.value }))}
                data-testid="input-transfer-quantity"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="transfer-note">Notering (valfritt)</Label>
              <Input
                id="transfer-note"
                value={transferState.note}
                onChange={(e) => setTransferState((s) => ({ ...s, note: e.target.value }))}
                data-testid="input-transfer-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)} data-testid="button-cancel-transfer">
              Avbryt
            </Button>
            <Button
              disabled={
                transferMutation.isPending ||
                !transferState.articleId ||
                !transferState.fromLocation ||
                !transferState.toLocation ||
                transferState.fromLocation === transferState.toLocation ||
                !(Number(transferState.quantity) > 0)
              }
              onClick={() =>
                transferMutation.mutate({
                  articleId: transferState.articleId,
                  fromLocation: transferState.fromLocation,
                  toLocation: transferState.toLocation,
                  quantity: Math.round(Number(transferState.quantity)),
                  note: transferState.note.trim() || undefined,
                })
              }
              data-testid="button-save-transfer"
            >
              {transferMutation.isPending ? "Överför…" : "Överför"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inventering */}
      <Dialog open={countOpen} onOpenChange={setCountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Inventering</DialogTitle>
            <DialogDescription>Registrera räknat saldo — differensen mot bokfört saldo loggas som inventering.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Artikel</Label>
              <Select value={countState.articleId} onValueChange={(v) => setCountState((s) => ({ ...s, articleId: v }))}>
                <SelectTrigger data-testid="select-count-article">
                  <SelectValue placeholder="Välj artikel" />
                </SelectTrigger>
                <SelectContent>
                  {sortedArticles.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Lagerplats</Label>
              <Select value={countState.location} onValueChange={(v) => setCountState((s) => ({ ...s, location: v }))}>
                <SelectTrigger data-testid="select-count-location">
                  <SelectValue placeholder="Välj lagerplats" />
                </SelectTrigger>
                <SelectContent>
                  {locationOptions.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="count-balance">Räknat saldo</Label>
              <Input
                id="count-balance"
                type="number"
                value={countState.countedBalance}
                onChange={(e) => setCountState((s) => ({ ...s, countedBalance: e.target.value }))}
                data-testid="input-count-balance"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="count-note">Notering (valfritt)</Label>
              <Input
                id="count-note"
                value={countState.note}
                onChange={(e) => setCountState((s) => ({ ...s, note: e.target.value }))}
                data-testid="input-count-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCountOpen(false)} data-testid="button-cancel-count">
              Avbryt
            </Button>
            <Button
              disabled={
                countMutation.isPending ||
                !countState.articleId ||
                !countState.location ||
                countState.countedBalance.trim() === "" ||
                !Number.isFinite(Number(countState.countedBalance))
              }
              onClick={() =>
                countMutation.mutate({
                  articleId: countState.articleId,
                  location: countState.location,
                  countedBalance: Math.round(Number(countState.countedBalance)),
                  note: countState.note.trim() || undefined,
                })
              }
              data-testid="button-save-count"
            >
              {countMutation.isPending ? "Sparar…" : "Registrera"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lagerplats-formulär */}
      <Dialog open={locationForm !== null} onOpenChange={(open) => !open && setLocationForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{locationForm?.id ? "Redigera lagerplats" : "Ny lagerplats"}</DialogTitle>
            <DialogDescription>
              Bil-lager kopplas till en resurs eller ett team — fältuttag på deras ordrar dras då från bilens lager.
            </DialogDescription>
          </DialogHeader>
          {locationForm && (
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="loc-name">Namn</Label>
                <Input
                  id="loc-name"
                  value={locationForm.name}
                  onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                  placeholder="T.ex. Huvudlager eller Bil 12"
                  data-testid="input-location-name"
                />
              </div>
              <div className="grid gap-2">
                <Label>Typ</Label>
                <Select
                  value={locationForm.kind}
                  onValueChange={(v) => setLocationForm({ ...locationForm, kind: v as "main" | "vehicle" })}
                >
                  <SelectTrigger data-testid="select-location-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">Huvudlager</SelectItem>
                    <SelectItem value="vehicle">Servicebil</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {locationForm.kind === "vehicle" && (
                <>
                  <div className="grid gap-2">
                    <Label>Resurs (valfritt)</Label>
                    <Select
                      value={locationForm.resourceId || "none"}
                      onValueChange={(v) => setLocationForm({ ...locationForm, resourceId: v === "none" ? "" : v })}
                    >
                      <SelectTrigger data-testid="select-location-resource">
                        <SelectValue placeholder="Ingen" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Ingen</SelectItem>
                        {resources.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Team (valfritt)</Label>
                    <Select
                      value={locationForm.teamId || "none"}
                      onValueChange={(v) => setLocationForm({ ...locationForm, teamId: v === "none" ? "" : v })}
                    >
                      <SelectTrigger data-testid="select-location-team">
                        <SelectValue placeholder="Inget" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Inget</SelectItem>
                        {teams.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <Label htmlFor="loc-active">Aktiv</Label>
                <Switch
                  id="loc-active"
                  checked={locationForm.isActive}
                  onCheckedChange={(v) => setLocationForm({ ...locationForm, isActive: v })}
                  data-testid="switch-location-active"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="loc-notes">Notering (valfritt)</Label>
                <Input
                  id="loc-notes"
                  value={locationForm.notes}
                  onChange={(e) => setLocationForm({ ...locationForm, notes: e.target.value })}
                  data-testid="input-location-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLocationForm(null)} data-testid="button-cancel-location">
              Avbryt
            </Button>
            <Button
              disabled={locationMutation.isPending || !locationForm?.name.trim()}
              onClick={() => locationForm && locationMutation.mutate(locationForm)}
              data-testid="button-save-location"
            >
              {locationMutation.isPending ? "Sparar…" : "Spara"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
