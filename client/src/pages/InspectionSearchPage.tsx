import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ClipboardCheck,
  Search,
  Download,
  Filter,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Plus,
  MapPin,
  Calendar,
  User,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { InspectionMetadata, ServiceObject } from "@shared/schema";
import { INSPECTION_TYPE_LABELS, INSPECTION_STATUS_LABELS } from "@shared/schema";

export default function InspectionSearchPage() {
  const { toast } = useToast();
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [showCreateOrderDialog, setShowCreateOrderDialog] = useState(false);
  const [selectedInspections, setSelectedInspections] = useState<Set<string>>(new Set());

  const { data: inspections = [], isLoading } = useQuery<InspectionMetadata[]>({
    queryKey: [`/api/inspection-metadata/search?${new URLSearchParams({
      ...(filterType !== "all" ? { inspectionType: filterType } : {}),
      ...(filterStatus !== "all" ? { status: filterStatus } : {}),
    }).toString()}`],
  });

  const { data: objects = [] } = useQuery<ServiceObject[]>({
    queryKey: ["/api/objects"],
  });

  const objectMap = useMemo(() => new Map(objects.map(o => [o.id, o])), [objects]);

  const filtered = useMemo(() => {
    if (!searchText.trim()) return inspections;
    const lower = searchText.toLowerCase();
    return inspections.filter(i => {
      const obj = objectMap.get(i.objectId);
      const objName = obj?.name?.toLowerCase() || "";
      const objAddr = obj?.address?.toLowerCase() || "";
      const comment = i.comment?.toLowerCase() || "";
      return objName.includes(lower) || objAddr.includes(lower) || comment.includes(lower);
    });
  }, [inspections, searchText, objectMap]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const ok = filtered.filter(i => i.status === "ok").length;
    const warnings = filtered.filter(i => i.status === "warning").length;
    const errors = filtered.filter(i => i.status === "error").length;
    return { total, ok, warnings, errors };
  }, [filtered]);

  const createActionOrderMutation = useMutation({
    mutationFn: async (inspectionIds: string[]) => {
      const selected = inspections.filter(i => inspectionIds.includes(i.id));
      const results = [];
      for (const inspection of selected) {
        const obj = objectMap.get(inspection.objectId);
        const issues = (inspection.issues as string[]) || [];
        const res = await apiRequest("POST", "/api/work-orders", {
          title: `Åtgärd: ${INSPECTION_TYPE_LABELS[inspection.inspectionType] || inspection.inspectionType} - ${issues.join(", ") || inspection.status}`,
          objectId: inspection.objectId,
          objectName: obj?.name || "",
          objectAddress: obj?.address || "",
          priority: inspection.status === "error" ? "high" : "normal",
          status: "pending",
          creationMethod: "inspection",
          notes: `Skapad från besiktning. ${inspection.comment || ""}`.trim(),
        });
        results.push(await res.json());
      }
      return results;
    },
    onSuccess: (data) => {
      toast({
        title: "Åtgärdsorder skapade",
        description: `${data.length} arbetsorder skapade från besiktningsresultat.`,
      });
      setShowCreateOrderDialog(false);
      setSelectedInspections(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
    onError: () => {
      toast({ title: "Fel", description: "Kunde inte skapa åtgärdsorder.", variant: "destructive" });
    },
  });

  const handleExportCSV = () => {
    const headers = ["Typ", "Status", "Objekt", "Adress", "Problem", "Kommentar", "Inspektör", "Datum"];
    const rows = filtered.map(i => {
      const obj = objectMap.get(i.objectId);
      const issues = (i.issues as string[]) || [];
      return [
        INSPECTION_TYPE_LABELS[i.inspectionType] || i.inspectionType,
        INSPECTION_STATUS_LABELS[i.status] || i.status,
        obj?.name || "",
        obj?.address || "",
        issues.join("; "),
        i.comment || "",
        i.inspectedBy || "",
        i.inspectedAt ? format(new Date(i.inspectedAt), "yyyy-MM-dd HH:mm") : "",
      ];
    });

    const csv = [headers.join(";"), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";"))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `besiktning_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exporterat", description: `${filtered.length} rader exporterade till CSV.` });
  };

  const toggleSelection = (id: string) => {
    setSelectedInspections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedInspections.size === filtered.length) {
      setSelectedInspections(new Set());
    } else {
      setSelectedInspections(new Set(filtered.map(i => i.id)));
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "ok": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "warning": return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case "error": return <AlertCircle className="h-4 w-4 text-red-500" />;
      default: return null;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, string> = {
      ok: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    };
    return (
      <Badge className={`${variants[status] || ""} gap-1`} data-testid={`badge-status-${status}`}>
        {getStatusIcon(status)}
        {INSPECTION_STATUS_LABELS[status] || status}
      </Badge>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <ClipboardCheck className="h-6 w-6 text-teal-600" />
            Besiktningsresultat
          </h1>
          <p className="text-muted-foreground mt-1">Sök, filtrera och agera på besiktningsdata</p>
        </div>
        <div className="flex gap-2">
          {selectedInspections.size > 0 && (
            <Button
              onClick={() => setShowCreateOrderDialog(true)}
              className="gap-2"
              data-testid="button-create-action-orders"
            >
              <Plus className="h-4 w-4" />
              Skapa åtgärdsorder ({selectedInspections.size})
            </Button>
          )}
          <Button variant="outline" onClick={handleExportCSV} className="gap-2" data-testid="button-export-csv">
            <Download className="h-4 w-4" />
            Exportera CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card data-testid="card-stat-total">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Totalt</p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-ok">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-green-600">{stats.ok}</p>
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> OK
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-warning">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-amber-600">{stats.warnings}</p>
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Varning
            </p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-error">
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-red-600">{stats.errors}</p>
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <AlertCircle className="h-3 w-3" /> Fel
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Besiktningstyp</label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger data-testid="select-filter-type">
                  <SelectValue placeholder="Alla typer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla typer</SelectItem>
                  {Object.entries(INSPECTION_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger data-testid="select-filter-status">
                  <SelectValue placeholder="Alla statusar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla statusar</SelectItem>
                  {Object.entries(INSPECTION_STATUS_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Sök</label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                <Input
                  placeholder="Sök objekt, adress, kommentar..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium">Inga besiktningsresultat</p>
              <p className="text-sm text-muted-foreground">Ändra filtren eller utför besiktningar i Traivo Go.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={selectedInspections.size === filtered.length && filtered.length > 0}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border"
                      data-testid="checkbox-select-all"
                    />
                  </TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Objekt</TableHead>
                  <TableHead>Adress</TableHead>
                  <TableHead>Problem</TableHead>
                  <TableHead>Inspektör</TableHead>
                  <TableHead>Datum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => {
                  const obj = objectMap.get(item.objectId);
                  const issues = (item.issues as string[]) || [];
                  return (
                    <TableRow key={item.id} data-testid={`row-inspection-${item.id}`}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedInspections.has(item.id)}
                          onChange={() => toggleSelection(item.id)}
                          className="h-4 w-4 rounded border"
                          data-testid={`checkbox-inspection-${item.id}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {INSPECTION_TYPE_LABELS[item.inspectionType] || item.inspectionType}
                        </Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell className="font-medium">{obj?.name || "-"}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {obj?.address || "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {issues.map((issue, idx) => (
                            <Badge key={idx} variant="outline" className="text-[10px]">
                              {issue}
                            </Badge>
                          ))}
                          {item.comment && (
                            <span className="text-xs text-muted-foreground italic">{item.comment}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 text-sm">
                          <User className="h-3 w-3 text-muted-foreground" />
                          {item.inspectedBy || "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {item.inspectedAt ? format(new Date(item.inspectedAt), "d MMM yyyy", { locale: sv }) : "-"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateOrderDialog} onOpenChange={setShowCreateOrderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Skapa åtgärdsorder
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Skapa arbetsorder för {selectedInspections.size} besiktningsresultat med avvikelser?
            </p>
            <div className="max-h-60 overflow-auto space-y-2">
              {Array.from(selectedInspections).map(id => {
                const item = inspections.find(i => i.id === id);
                if (!item) return null;
                const obj = objectMap.get(item.objectId);
                const issues = (item.issues as string[]) || [];
                return (
                  <div key={id} className="flex items-center gap-3 p-2 border rounded-lg text-sm">
                    {getStatusIcon(item.status)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {INSPECTION_TYPE_LABELS[item.inspectionType] || item.inspectionType}: {issues.join(", ") || item.status}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{obj?.name} - {obj?.address}</p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => toggleSelection(id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateOrderDialog(false)}>
              Avbryt
            </Button>
            <Button
              onClick={() => createActionOrderMutation.mutate(Array.from(selectedInspections))}
              disabled={createActionOrderMutation.isPending}
              data-testid="button-confirm-create-orders"
            >
              {createActionOrderMutation.isPending ? "Skapar..." : `Skapa ${selectedInspections.size} order`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
