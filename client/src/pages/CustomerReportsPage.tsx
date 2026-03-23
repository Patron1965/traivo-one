import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Camera, Search, MapPin, Loader2, CheckCircle, AlertTriangle,
  Package, Wrench, HelpCircle, Clock, Building2, Eye, Trash2,
  Filter, MessageSquare, ClipboardList, ExternalLink, X
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

const CATEGORIES: Record<string, string> = {
  antal_karl_andrat: "Antal kärl ändrat",
  skadat_material: "Skadat material",
  tillganglighet: "Tillgänglighetsproblem",
  skador: "Skador på utrymme",
  rengorings_behov: "Rengöringsbehov",
  ovrigt: "Övrigt",
};

const STATUS_LABELS: Record<string, string> = {
  new: "Ny",
  reviewed: "Granskas",
  resolved: "Löst",
  rejected: "Avvisad",
};

interface ChangeRequest {
  id: string;
  tenantId: string;
  customerId: string;
  objectId: string;
  category: string;
  description: string;
  photos: string[] | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  reviewNotes: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  objectName?: string;
  objectAddress?: string;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "new": return <Badge className="bg-blue-500 text-white" data-testid={`badge-status-${status}`}>Ny</Badge>;
    case "reviewed": return <Badge className="bg-amber-500 text-white" data-testid={`badge-status-${status}`}>Granskas</Badge>;
    case "resolved": return <Badge className="bg-green-500 text-white" data-testid={`badge-status-${status}`}>Löst</Badge>;
    case "rejected": return <Badge variant="secondary" data-testid={`badge-status-${status}`}>Avvisad</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function getCategoryIcon(cat: string) {
  switch (cat) {
    case "antal_karl_andrat": return <Package className="h-4 w-4" />;
    case "skadat_material": return <Wrench className="h-4 w-4" />;
    case "tillganglighet":
    case "skador": return <AlertTriangle className="h-4 w-4" />;
    case "rengorings_behov": return <Trash2 className="h-4 w-4" />;
    default: return <HelpCircle className="h-4 w-4" />;
  }
}

export default function CustomerReportsPage() {
  const qc = useQueryClient();
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const initialObjectId = params.get("objectId") || "";

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [objectIdFilter, setObjectIdFilter] = useState<string>(initialObjectId);
  const [search, setSearch] = useState("");
  const [selectedReport, setSelectedReport] = useState<ChangeRequest | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [newStatus, setNewStatus] = useState("");

  const { data: reports = [], isLoading } = useQuery<ChangeRequest[]>({
    queryKey: ["/api/customer-change-requests", statusFilter, categoryFilter, objectIdFilter],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (statusFilter !== "all") p.set("status", statusFilter);
      if (categoryFilter !== "all") p.set("category", categoryFilter);
      if (objectIdFilter) p.set("objectId", objectIdFilter);
      const res = await fetch(`/api/customer-change-requests?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, reviewNotes }: { id: string; status: string; reviewNotes: string }) => {
      return apiRequest("PATCH", `/api/customer-change-requests/${id}/status`, { status, reviewNotes });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/customer-change-requests"] });
      setSelectedReport(null);
      setReviewNotes("");
      setNewStatus("");
    },
  });

  const createWorkOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/customer-change-requests/${id}/create-work-order`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/customer-change-requests"] });
      setSelectedReport(null);
    },
  });

  const filteredReports = reports.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      r.description?.toLowerCase().includes(s) ||
      r.customerName?.toLowerCase().includes(s) ||
      r.objectName?.toLowerCase().includes(s) ||
      CATEGORIES[r.category]?.toLowerCase().includes(s)
    );
  });

  const statusCounts = reports.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  function openReview(report: ChangeRequest) {
    setSelectedReport(report);
    setReviewNotes(report.reviewNotes || "");
    setNewStatus(report.status);
  }

  function clearObjectFilter() {
    setObjectIdFilter("");
    window.history.replaceState({}, "", "/customer-reports");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Camera className="h-6 w-6" />
            Kundrapporter — Fältdokumentation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hantera ändringsrapporter och foton från kunders fältdokumentation
          </p>
        </div>
      </div>

      {objectIdFilter && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-sm" data-testid="filter-banner-object">
          <Filter className="h-4 w-4 text-blue-500 shrink-0" />
          <span>Visar rapporter för ett specifikt objekt</span>
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={clearObjectFilter} data-testid="button-clear-object-filter">
            <X className="h-3 w-3 mr-1" />
            Rensa filter
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className={`cursor-pointer hover:shadow-md transition-shadow ${statusFilter === "new" ? "ring-2 ring-blue-500" : ""}`} onClick={() => setStatusFilter("new")} data-testid="stat-new">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-500">{statusCounts["new"] || 0}</p>
            <p className="text-xs text-muted-foreground">Nya</p>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer hover:shadow-md transition-shadow ${statusFilter === "reviewed" ? "ring-2 ring-amber-500" : ""}`} onClick={() => setStatusFilter("reviewed")} data-testid="stat-reviewed">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-500">{statusCounts["reviewed"] || 0}</p>
            <p className="text-xs text-muted-foreground">Under granskning</p>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer hover:shadow-md transition-shadow ${statusFilter === "resolved" ? "ring-2 ring-green-500" : ""}`} onClick={() => setStatusFilter("resolved")} data-testid="stat-resolved">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-500">{statusCounts["resolved"] || 0}</p>
            <p className="text-xs text-muted-foreground">Lösta</p>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer hover:shadow-md transition-shadow ${statusFilter === "all" ? "ring-2 ring-primary" : ""}`} onClick={() => setStatusFilter("all")} data-testid="stat-all">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{reports.length}</p>
            <p className="text-xs text-muted-foreground">Totalt</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök rapporter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
            data-testid="input-search-reports"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla statusar</SelectItem>
            <SelectItem value="new">Nya</SelectItem>
            <SelectItem value="reviewed">Under granskning</SelectItem>
            <SelectItem value="resolved">Lösta</SelectItem>
            <SelectItem value="rejected">Avvisade</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
            <SelectValue placeholder="Alla kategorier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla kategorier</SelectItem>
            {Object.entries(CATEGORIES).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredReports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Camera className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Inga rapporter hittades</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="list-reports">
          {filteredReports.map(report => (
            <Card
              key={report.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => openReview(report)}
              data-testid={`card-report-${report.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getCategoryIcon(report.category)}
                      <span className="font-medium text-sm">{CATEGORIES[report.category] || report.category}</span>
                      {getStatusBadge(report.status)}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{report.description}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      {report.customerName && (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {report.customerName}
                        </span>
                      )}
                      {report.objectName && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {report.objectName}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(report.createdAt).toLocaleDateString("sv")}
                      </span>
                      {report.photos && report.photos.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Camera className="h-3 w-3" />
                          {report.photos.length} foto{report.photos.length !== 1 ? "n" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <Eye className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selectedReport} onOpenChange={(open) => { if (!open) setSelectedReport(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedReport && getCategoryIcon(selectedReport.category)}
              {selectedReport && (CATEGORIES[selectedReport.category] || selectedReport.category)}
            </DialogTitle>
          </DialogHeader>

          {selectedReport && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {getStatusBadge(selectedReport.status)}
                <span>{new Date(selectedReport.createdAt).toLocaleString("sv")}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Kundinformation</p>
                  <div className="bg-muted/50 p-3 rounded-lg space-y-1 text-sm">
                    {selectedReport.customerName && (
                      <p className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-muted-foreground" /> {selectedReport.customerName}</p>
                    )}
                    {selectedReport.objectName && (
                      <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {selectedReport.objectName}</p>
                    )}
                    {selectedReport.objectAddress && (
                      <p className="text-xs text-muted-foreground ml-6">{selectedReport.objectAddress}</p>
                    )}
                    <Link href={`/objects?search=${encodeURIComponent(selectedReport.objectName || "")}`} className="text-xs text-blue-500 hover:underline ml-6 flex items-center gap-1" data-testid="link-goto-object">
                      <ExternalLink className="h-3 w-3" /> Visa objekt
                    </Link>
                  </div>
                </div>

                {selectedReport.latitude && selectedReport.longitude && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">GPS-position</p>
                    <div className="bg-muted/50 rounded-lg overflow-hidden">
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${selectedReport.latitude}&mlon=${selectedReport.longitude}#map=17/${selectedReport.latitude}/${selectedReport.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-4 text-center hover:bg-muted/80 transition-colors"
                        data-testid="link-gps-map"
                      >
                        <MapPin className="h-8 w-8 mx-auto text-red-500 mb-2" />
                        <p className="text-sm font-medium text-blue-500 hover:underline flex items-center justify-center gap-1">
                          <ExternalLink className="h-3 w-3" />
                          Öppna karta
                        </p>
                      </a>
                      <p className="text-[11px] text-muted-foreground p-2 border-t">
                        <MapPin className="h-3 w-3 inline mr-1" />
                        {selectedReport.latitude.toFixed(5)}, {selectedReport.longitude.toFixed(5)}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium mb-1">Beskrivning</p>
                <p className="text-sm bg-muted/50 p-3 rounded-lg whitespace-pre-wrap" data-testid="text-report-description">{selectedReport.description}</p>
              </div>

              {selectedReport.photos && selectedReport.photos.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Foton ({selectedReport.photos.length})</p>
                  <div className="flex gap-2 flex-wrap">
                    {selectedReport.photos.filter(p => p.startsWith("/objects/")).map((p, i) => (
                      <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="block w-24 h-24 rounded border bg-muted overflow-hidden relative" data-testid={`photo-thumb-${i}`}>
                        <img src={p} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <Camera className="h-5 w-5 text-muted-foreground opacity-30" />
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-4 space-y-3">
                <p className="text-sm font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Hantera rapport
                </p>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger data-testid="select-new-status">
                    <SelectValue placeholder="Välj status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Ny</SelectItem>
                    <SelectItem value="reviewed">Under granskning</SelectItem>
                    <SelectItem value="resolved">Löst</SelectItem>
                    <SelectItem value="rejected">Avvisad</SelectItem>
                  </SelectContent>
                </Select>
                <Textarea
                  placeholder="Kommentar till kund..."
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  data-testid="input-review-notes"
                />
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2">
                {selectedReport.status !== "resolved" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (selectedReport) createWorkOrderMutation.mutate(selectedReport.id);
                    }}
                    disabled={createWorkOrderMutation.isPending}
                    className="mr-auto"
                    data-testid="button-create-work-order"
                  >
                    {createWorkOrderMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <ClipboardList className="h-4 w-4 mr-2" />
                    )}
                    Skapa arbetsorder
                  </Button>
                )}
                <Button variant="outline" onClick={() => setSelectedReport(null)} data-testid="button-cancel-review">
                  Avbryt
                </Button>
                <Button
                  onClick={() => {
                    if (selectedReport && newStatus) {
                      updateMutation.mutate({ id: selectedReport.id, status: newStatus, reviewNotes });
                    }
                  }}
                  disabled={!newStatus || updateMutation.isPending}
                  data-testid="button-save-review"
                >
                  {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  Spara
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
